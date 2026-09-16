import { lstat, mkdir, realpath, stat, unlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { MediaExecutionPlan, MediaExecutor } from '../../../services/media-worker/src/index.js';
import {
  buildOutputIdentity,
  FfmpegExecutionError,
  NodeFfmpegProcessRunner,
  type FfmpegProcessRunner,
} from './ffmpeg-executor.js';

export const REPRESENTATIVE_FRAME_DEFAULT_MS = 1_000;

export interface ThumbnailFfmpegExecutorOptions {
  sandboxRoot: string;
  binary?: string;
  timeoutMs?: number;
  maxStderrBytes?: number;
  maxOutputBytes?: number;
  runner?: FfmpegProcessRunner;
  resolveSourcePath?: (plan: MediaExecutionPlan) => Promise<string> | string;
}

export class ThumbnailFfmpegExecutor implements MediaExecutor {
  private readonly sandboxRoot: string;
  private readonly binary: string;
  private readonly timeoutMs: number;
  private readonly maxStderrBytes: number;
  private readonly maxOutputBytes: number;
  private readonly runner: FfmpegProcessRunner;
  private readonly resolveSourcePath: (plan: MediaExecutionPlan) => Promise<string>;

  constructor(options: ThumbnailFfmpegExecutorOptions) {
    if (!options.sandboxRoot.trim()) throw new Error('thumbnail sandbox root is required');
    this.sandboxRoot = resolve(options.sandboxRoot);
    this.binary = options.binary?.trim() || 'ffmpeg';
    this.timeoutMs = positiveInteger(options.timeoutMs ?? 60_000, 'thumbnail timeoutMs');
    this.maxStderrBytes = positiveInteger(options.maxStderrBytes ?? 32 * 1024, 'thumbnail maxStderrBytes');
    this.maxOutputBytes = positiveInteger(options.maxOutputBytes ?? 20 * 1024 * 1024, 'thumbnail maxOutputBytes');
    this.runner = options.runner ?? new NodeFfmpegProcessRunner();
    this.resolveSourcePath = async (plan) => {
      const context = requireContext(plan);
      const path = options.resolveSourcePath
        ? await options.resolveSourcePath(plan)
        : resolve(this.sandboxRoot, context.sourceObjectKey);
      return resolve(path);
    };
  }

  async execute(plan: MediaExecutionPlan): Promise<{ assetId: string; uri: string }> {
    const context = requireContext(plan);
    const operation = thumbnailOperation(plan);
    const sourcePath = await this.resolveSourcePath(plan);
    await assertExistingFileInside(this.sandboxRoot, sourcePath);

    const identity = buildOutputIdentity(plan);
    const outputDir = resolve(this.sandboxRoot, 'work', safeSegment(context.projectId), safeSegment(context.jobId), 'frames');
    await mkdir(outputDir, { recursive: true });
    await assertDirectoryInside(this.sandboxRoot, outputDir);

    const extension = imageExtension(plan.output.container);
    const outputPath = resolve(outputDir, `${identity.hash}.${extension}`);
    assertInsideResolved(this.sandboxRoot, outputPath);
    await removeExistingRegularOutput(outputPath);

    const result = await this.runner.run(this.binary, buildThumbnailArgs(plan, sourcePath, outputPath), {
      cwd: this.sandboxRoot,
      timeoutMs: this.timeoutMs,
      maxStderrBytes: this.maxStderrBytes,
    }).catch((error: unknown) => {
      if (error instanceof FfmpegExecutionError) throw error;
      throw new FfmpegExecutionError('process-failed', 'thumbnail FFmpeg process could not be started');
    });

    if (result.exitCode !== 0) {
      const detail = result.stderr.trim();
      throw new FfmpegExecutionError('process-failed', detail ? `thumbnail FFmpeg failed: ${detail}` : 'thumbnail FFmpeg failed');
    }
    const outputStat = await stat(outputPath).catch(() => null);
    if (!outputStat?.isFile()) throw new FfmpegExecutionError('process-failed', 'thumbnail output file was not produced');
    if (outputStat.size > this.maxOutputBytes) {
      await unlink(outputPath).catch(() => undefined);
      throw new FfmpegExecutionError('output-too-large', 'thumbnail output exceeded the configured size limit');
    }

    void operation;
    return { assetId: identity.assetId, uri: pathToFileURL(outputPath).href };
  }
}

export class RoutedMediaExecutor implements MediaExecutor {
  constructor(
    private readonly video: MediaExecutor,
    private readonly thumbnail: MediaExecutor,
  ) {}

  execute(plan: MediaExecutionPlan): Promise<{ assetId: string; uri: string }> {
    const hasFrameExtraction = plan.operations.some((operation) => operation.type === 'extract-frame');
    return (hasFrameExtraction ? this.thumbnail : this.video).execute(plan);
  }
}

export function buildThumbnailArgs(plan: MediaExecutionPlan, inputPath: string, outputPath: string): string[] {
  const operation = thumbnailOperation(plan);
  imageExtension(plan.output.container);
  const atMs = operation.atMs ?? REPRESENTATIVE_FRAME_DEFAULT_MS;
  if (!Number.isFinite(atMs) || atMs < 0) throw new FfmpegExecutionError('invalid-plan', 'thumbnail timestamp must be non-negative');

  const args = [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    (atMs / 1000).toFixed(3),
    '-i',
    inputPath,
    '-frames:v',
    '1',
    '-an',
  ];
  if (operation.width !== undefined && operation.height !== undefined) {
    if (!Number.isInteger(operation.width) || !Number.isInteger(operation.height) || operation.width <= 0 || operation.height <= 0) {
      throw new FfmpegExecutionError('invalid-plan', 'thumbnail dimensions must be positive integers');
    }
    args.push('-vf', `scale=${operation.width}:${operation.height}:force_original_aspect_ratio=decrease`);
  }
  args.push('-f', 'image2', '-y', outputPath);
  return args;
}

function thumbnailOperation(plan: MediaExecutionPlan): Extract<MediaExecutionPlan['operations'][number], { type: 'extract-frame' }> {
  const frames = plan.operations.filter((operation) => operation.type === 'extract-frame');
  if (frames.length !== 1 || plan.operations.length !== 1) {
    throw new FfmpegExecutionError('invalid-plan', 'thumbnail execution requires exactly one extract-frame operation');
  }
  return frames[0] as Extract<MediaExecutionPlan['operations'][number], { type: 'extract-frame' }>;
}

function imageExtension(container: string): 'jpg' | 'png' {
  const normalized = container.toLowerCase();
  if (normalized === 'jpg' || normalized === 'jpeg') return 'jpg';
  if (normalized === 'png') return 'png';
  throw new FfmpegExecutionError('unsupported-format', `unsupported thumbnail container: ${container}`);
}

function requireContext(plan: MediaExecutionPlan): NonNullable<MediaExecutionPlan['context']> {
  const context = plan.context;
  if (!context?.projectId || !context.jobId || !context.sourceObjectKey) {
    throw new FfmpegExecutionError('invalid-plan', 'thumbnail execution requires project, job, and source-object context');
  }
  return context;
}

async function canonicalRoot(root: string): Promise<string> {
  await mkdir(root, { recursive: true });
  return realpath(root);
}

async function assertExistingFileInside(root: string, candidate: string): Promise<void> {
  const canonical = await realpath(candidate).catch(() => null);
  const rootPath = await canonicalRoot(root);
  if (!canonical || !isInside(rootPath, canonical)) throw new FfmpegExecutionError('unsafe-path', 'thumbnail source escapes sandbox');
  const info = await stat(canonical);
  if (!info.isFile()) throw new FfmpegExecutionError('unsafe-path', 'thumbnail source must be a regular file');
}

async function assertDirectoryInside(root: string, candidate: string): Promise<void> {
  const rootPath = await canonicalRoot(root);
  const canonical = await realpath(candidate).catch(() => null);
  if (!canonical || !isInside(rootPath, canonical)) throw new FfmpegExecutionError('unsafe-path', 'thumbnail output directory escapes sandbox');
}

function assertInsideResolved(root: string, candidate: string): void {
  if (!isInside(resolve(root), resolve(candidate))) throw new FfmpegExecutionError('unsafe-path', 'thumbnail output path escapes sandbox');
}

function isInside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
}

async function removeExistingRegularOutput(path: string): Promise<void> {
  const existing = await lstat(path).catch(() => null);
  if (!existing) return;
  if (existing.isSymbolicLink() || !existing.isFile()) throw new FfmpegExecutionError('unsafe-path', 'thumbnail output is not a regular file');
  await unlink(path);
}

function safeSegment(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!safe || safe === '.' || safe === '..') throw new FfmpegExecutionError('unsafe-path', 'unsafe thumbnail context segment');
  return safe;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}
