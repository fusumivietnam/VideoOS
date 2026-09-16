import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, realpath, stat, unlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { MediaOperation } from '@videoos/contracts';
import type { MediaExecutionPlan, MediaExecutor } from '../../../services/media-worker/src/index.js';
import type { SubtitleStager } from './subtitle-stager.js';

export interface FfmpegProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}

export interface FfmpegProcessRunner {
  run(
    binary: string,
    args: string[],
    options: { cwd: string; timeoutMs: number; maxStderrBytes: number },
  ): Promise<FfmpegProcessResult>;
}

export interface FfmpegExecutorOptions {
  sandboxRoot: string;
  binary?: string;
  timeoutMs?: number;
  maxStderrBytes?: number;
  maxOutputBytes?: number;
  runner?: FfmpegProcessRunner;
  subtitleStager?: SubtitleStager;
  resolveSourcePath?: (plan: MediaExecutionPlan) => Promise<string> | string;
}

export class FfmpegExecutionError extends Error {
  constructor(
    readonly code:
      | 'invalid-plan'
      | 'unsafe-path'
      | 'unsupported-operation'
      | 'unsupported-format'
      | 'process-failed'
      | 'timeout'
      | 'output-too-large',
    message: string,
  ) {
    super(message);
    this.name = 'FfmpegExecutionError';
  }
}

export class FfmpegExecutor implements MediaExecutor {
  private readonly sandboxRoot: string;
  private readonly binary: string;
  private readonly timeoutMs: number;
  private readonly maxStderrBytes: number;
  private readonly maxOutputBytes: number;
  private readonly runner: FfmpegProcessRunner;
  private readonly subtitleStager: SubtitleStager | undefined;
  private readonly resolveSourcePath: (plan: MediaExecutionPlan) => Promise<string>;

  constructor(options: FfmpegExecutorOptions) {
    if (!options.sandboxRoot.trim()) throw new Error('FFmpeg sandbox root is required');
    this.sandboxRoot = resolve(options.sandboxRoot);
    this.binary = options.binary?.trim() || 'ffmpeg';
    this.timeoutMs = positiveInteger(options.timeoutMs ?? 15 * 60_000, 'FFmpeg timeoutMs');
    this.maxStderrBytes = positiveInteger(options.maxStderrBytes ?? 64 * 1024, 'FFmpeg maxStderrBytes');
    this.maxOutputBytes = positiveInteger(options.maxOutputBytes ?? 4 * 1024 * 1024 * 1024, 'FFmpeg maxOutputBytes');
    this.runner = options.runner ?? new NodeFfmpegProcessRunner();
    this.subtitleStager = options.subtitleStager;
    this.resolveSourcePath = async (plan) => {
      const value = options.resolveSourcePath
        ? await options.resolveSourcePath(plan)
        : resolve(this.sandboxRoot, requireExecutionContext(plan).sourceObjectKey);
      return resolve(value);
    };
  }

  async execute(plan: MediaExecutionPlan): Promise<{ assetId: string; uri: string }> {
    const context = requireExecutionContext(plan);
    const sourcePath = await this.resolveSourcePath(plan);
    await assertExistingPathInsideSandbox(this.sandboxRoot, sourcePath);

    const identity = buildOutputIdentity(plan);
    const outputDir = resolve(
      this.sandboxRoot,
      'work',
      safeSegment(context.projectId),
      safeSegment(context.jobId),
    );
    await mkdir(outputDir, { recursive: true });
    await assertDirectoryInsideSandbox(this.sandboxRoot, outputDir);

    const extension = containerExtension(plan.output.container);
    const outputPath = resolve(outputDir, `${identity.hash}.${extension}`);
    assertResolvedInsideSandbox(this.sandboxRoot, outputPath);
    await removeExistingRegularOutput(outputPath);

    const stagedSubtitles = new Map<string, string>();
    for (const operation of plan.operations) {
      if (operation.type !== 'burn-subtitles') continue;
      if (!this.subtitleStager) {
        throw new FfmpegExecutionError('unsupported-operation', 'burn-subtitles requires a configured subtitle stager');
      }
      const stagedPath = await this.subtitleStager.stage(operation.subtitleAssetId, plan);
      await assertExistingPathInsideSandbox(this.sandboxRoot, stagedPath);
      stagedSubtitles.set(operation.subtitleAssetId, stagedPath);
    }

    const args = buildFfmpegArgs(plan, sourcePath, outputPath, stagedSubtitles);
    let result: FfmpegProcessResult;
    try {
      result = await this.runner.run(this.binary, args, {
        cwd: this.sandboxRoot,
        timeoutMs: this.timeoutMs,
        maxStderrBytes: this.maxStderrBytes,
      });
    } catch (error) {
      if (error instanceof FfmpegExecutionError) throw error;
      throw new FfmpegExecutionError('process-failed', 'FFmpeg process could not be started');
    }

    if (result.exitCode !== 0) {
      const detail = result.stderr.trim();
      throw new FfmpegExecutionError(
        'process-failed',
        detail ? `FFmpeg failed: ${detail}` : 'FFmpeg failed without diagnostic output',
      );
    }

    const outputStat = await stat(outputPath).catch(() => null);
    if (!outputStat?.isFile()) {
      throw new FfmpegExecutionError('process-failed', 'FFmpeg completed without producing the expected output file');
    }
    if (outputStat.size > this.maxOutputBytes) {
      await unlink(outputPath).catch(() => undefined);
      throw new FfmpegExecutionError('output-too-large', 'FFmpeg output exceeded the configured size limit');
    }

    return {
      assetId: identity.assetId,
      uri: pathToFileURL(outputPath).href,
    };
  }
}

export class NodeFfmpegProcessRunner implements FfmpegProcessRunner {
  run(
    binary: string,
    args: string[],
    options: { cwd: string; timeoutMs: number; maxStderrBytes: number },
  ): Promise<FfmpegProcessResult> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(binary, args, {
        cwd: options.cwd,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      });

      let stderrBytes = 0;
      const chunks: Buffer[] = [];
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, options.timeoutMs);
      timer.unref();

      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderrBytes >= options.maxStderrBytes) return;
        const remaining = options.maxStderrBytes - stderrBytes;
        const slice = chunk.subarray(0, remaining);
        chunks.push(slice);
        stderrBytes += slice.byteLength;
      });

      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', (exitCode, signal) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new FfmpegExecutionError('timeout', 'FFmpeg exceeded the configured execution timeout'));
          return;
        }
        resolvePromise({
          exitCode,
          signal,
          stderr: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
  }
}

export function buildFfmpegArgs(
  plan: MediaExecutionPlan,
  inputPath: string,
  outputPath: string,
  stagedSubtitles: ReadonlyMap<string, string> = new Map(),
): string[] {
  requireExecutionContext(plan);
  const trimOperations = plan.operations.filter((operation) => operation.type === 'trim');
  if (trimOperations.length > 1) {
    throw new FfmpegExecutionError('invalid-plan', 'FFmpeg executor supports at most one trim operation');
  }

  const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe'];
  const trim = trimOperations[0];
  if (trim?.type === 'trim') args.push('-ss', seconds(trim.startMs));
  args.push('-i', inputPath);
  if (trim?.type === 'trim') args.push('-t', seconds(trim.endMs - trim.startMs));

  const videoFilters: string[] = [];
  const audioFilters: string[] = [];
  let explicitResize = false;

  for (const operation of plan.operations) {
    switch (operation.type) {
      case 'trim':
        break;
      case 'resize':
        if (explicitResize) {
          throw new FfmpegExecutionError('invalid-plan', 'FFmpeg executor supports at most one resize operation');
        }
        explicitResize = true;
        videoFilters.push(resizeFilter(operation));
        break;
      case 'normalize-audio':
        if (!Number.isFinite(operation.targetLufs) || operation.targetLufs < -70 || operation.targetLufs > -5) {
          throw new FfmpegExecutionError('invalid-plan', 'normalize-audio targetLufs must be between -70 and -5');
        }
        audioFilters.push(`loudnorm=I=${operation.targetLufs}`);
        break;
      case 'burn-subtitles': {
        const stagedPath = stagedSubtitles.get(operation.subtitleAssetId);
        if (!stagedPath) {
          throw new FfmpegExecutionError('unsupported-operation', 'burn-subtitles requires a staged subtitle asset');
        }
        videoFilters.push(`subtitles='${escapeSubtitleFilterPath(stagedPath)}'`);
        break;
      }
      default: {
        const exhaustive: never = operation;
        throw new FfmpegExecutionError('unsupported-operation', `unsupported media operation: ${String(exhaustive)}`);
      }
    }
  }

  if (!explicitResize && (plan.output.width !== undefined || plan.output.height !== undefined)) {
    if (!plan.output.width || !plan.output.height) {
      throw new FfmpegExecutionError('invalid-plan', 'output width and height must be provided together');
    }
    videoFilters.push(`scale=${plan.output.width}:${plan.output.height}`);
  }

  if (videoFilters.length) args.push('-vf', videoFilters.join(','));
  if (audioFilters.length) args.push('-af', audioFilters.join(','));
  if (plan.output.fps !== undefined) {
    if (!Number.isFinite(plan.output.fps) || plan.output.fps <= 0 || plan.output.fps > 240) {
      throw new FfmpegExecutionError('invalid-plan', 'output fps must be between 0 and 240');
    }
    args.push('-r', String(plan.output.fps));
  }

  if (plan.output.videoCodec) args.push('-c:v', mapVideoCodec(plan.output.videoCodec));
  if (plan.output.audioCodec) args.push('-c:a', mapAudioCodec(plan.output.audioCodec));

  args.push('-map_metadata', '-1', '-f', mapContainer(plan.output.container), '-y', outputPath);
  return args;
}

export function buildOutputIdentity(plan: MediaExecutionPlan): { hash: string; assetId: string } {
  const context = requireExecutionContext(plan);
  const canonical = JSON.stringify({
    projectId: context.projectId,
    jobId: context.jobId,
    sourceAssetId: plan.sourceAssetId,
    sourceObjectKey: context.sourceObjectKey,
    preset: plan.preset,
    operations: plan.operations,
    output: plan.output,
  });
  const hash = createHash('sha256').update(canonical).digest('hex');
  return { hash, assetId: `asset:derived:${hash.slice(0, 24)}` };
}

function resizeFilter(operation: Extract<MediaOperation, { type: 'resize' }>): string {
  const { width, height } = operation;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new FfmpegExecutionError('invalid-plan', 'resize dimensions must be positive integers');
  }
  if (operation.fit === 'cover') {
    return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
  }
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
}

function escapeSubtitleFilterPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function mapVideoCodec(codec: string): string {
  const normalized = codec.toLowerCase();
  const mapping: Record<string, string> = {
    h264: 'libx264',
    libx264: 'libx264',
    h265: 'libx265',
    hevc: 'libx265',
    libx265: 'libx265',
    vp9: 'libvpx-vp9',
    'libvpx-vp9': 'libvpx-vp9',
    av1: 'libaom-av1',
    'libaom-av1': 'libaom-av1',
    copy: 'copy',
  };
  const mapped = mapping[normalized];
  if (!mapped) throw new FfmpegExecutionError('unsupported-format', `unsupported video codec: ${codec}`);
  return mapped;
}

function mapAudioCodec(codec: string): string {
  const normalized = codec.toLowerCase();
  const mapping: Record<string, string> = {
    aac: 'aac',
    opus: 'libopus',
    libopus: 'libopus',
    mp3: 'libmp3lame',
    libmp3lame: 'libmp3lame',
    copy: 'copy',
  };
  const mapped = mapping[normalized];
  if (!mapped) throw new FfmpegExecutionError('unsupported-format', `unsupported audio codec: ${codec}`);
  return mapped;
}

function mapContainer(container: string): string {
  const normalized = container.toLowerCase();
  const mapping: Record<string, string> = {
    mp4: 'mp4',
    mov: 'mov',
    webm: 'webm',
    mkv: 'matroska',
    matroska: 'matroska',
  };
  const mapped = mapping[normalized];
  if (!mapped) throw new FfmpegExecutionError('unsupported-format', `unsupported output container: ${container}`);
  return mapped;
}

function containerExtension(container: string): string {
  const mapped = mapContainer(container);
  return mapped === 'matroska' ? 'mkv' : mapped;
}

async function assertExistingPathInsideSandbox(root: string, candidate: string): Promise<void> {
  const canonicalRoot = await ensureCanonicalRoot(root);
  const canonicalCandidate = await realpath(candidate).catch(() => null);
  if (!canonicalCandidate || !isInside(canonicalRoot, canonicalCandidate)) {
    throw new FfmpegExecutionError('unsafe-path', 'media source path is missing or outside the FFmpeg sandbox');
  }
  const sourceStat = await stat(canonicalCandidate);
  if (!sourceStat.isFile()) {
    throw new FfmpegExecutionError('unsafe-path', 'media source path must resolve to a regular file');
  }
}

async function assertDirectoryInsideSandbox(root: string, candidate: string): Promise<void> {
  const canonicalRoot = await ensureCanonicalRoot(root);
  const canonicalCandidate = await realpath(candidate).catch(() => null);
  if (!canonicalCandidate || !isInside(canonicalRoot, canonicalCandidate)) {
    throw new FfmpegExecutionError('unsafe-path', 'FFmpeg output directory escapes the configured sandbox');
  }
}

async function ensureCanonicalRoot(root: string): Promise<string> {
  await mkdir(root, { recursive: true });
  return realpath(root);
}

function assertResolvedInsideSandbox(root: string, candidate: string): void {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (!isInside(resolvedRoot, resolvedCandidate)) {
    throw new FfmpegExecutionError('unsafe-path', 'FFmpeg output path escapes the configured sandbox');
  }
}

function isInside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
}

async function removeExistingRegularOutput(outputPath: string): Promise<void> {
  const existing = await lstat(outputPath).catch(() => null);
  if (!existing) return;
  if (existing.isSymbolicLink() || !existing.isFile()) {
    throw new FfmpegExecutionError('unsafe-path', 'existing FFmpeg output path is not a regular file');
  }
  await unlink(outputPath);
}

function requireExecutionContext(plan: MediaExecutionPlan): NonNullable<MediaExecutionPlan['context']> {
  const context = plan.context;
  if (!context?.projectId || !context.jobId || !context.sourceObjectKey) {
    throw new FfmpegExecutionError('invalid-plan', 'FFmpeg execution requires project, job, and source-object context');
  }
  return context;
}

function safeSegment(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!normalized || normalized === '.' || normalized === '..') {
    throw new FfmpegExecutionError('unsafe-path', 'execution context contains an unsafe path segment');
  }
  return normalized;
}

function seconds(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new FfmpegExecutionError('invalid-plan', 'trim timestamps must be non-negative finite milliseconds');
  }
  return (milliseconds / 1000).toFixed(3);
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}
