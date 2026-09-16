import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { MediaTransformRequest } from '@videoos/contracts';
import {
  buildProjectObjectKey,
  type AssetRecord,
  type AssetRepository,
  type ObjectStore,
} from '@videoos/storage';

export interface NormalizedMediaMetadata {
  durationMs?: number;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  audioSampleRateHz?: number;
  audioChannels?: number;
}

export interface MediaProbe {
  probe(filePath: string): Promise<NormalizedMediaMetadata>;
}

export interface MediaArtifactFinalizeInput {
  projectId: string;
  jobId: string;
  sourceAssetId: string;
  transform: Omit<MediaTransformRequest, 'sourceAssetId'>;
  result: { assetId: string; uri: string };
  executor: string;
  executorVersion?: string;
}

export interface MediaArtifactFinalizer {
  finalize(input: MediaArtifactFinalizeInput): Promise<AssetRecord>;
}

export interface FfprobeRunner {
  run(binary: string, args: string[], options: { timeoutMs: number; maxOutputBytes: number }): Promise<string>;
}

export class FfprobeMediaProbe implements MediaProbe {
  private readonly binary: string;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly runner: FfprobeRunner;

  constructor(options: {
    binary?: string;
    timeoutMs?: number;
    maxOutputBytes?: number;
    runner?: FfprobeRunner;
  } = {}) {
    this.binary = options.binary?.trim() || 'ffprobe';
    this.timeoutMs = positiveInteger(options.timeoutMs ?? 30_000, 'ffprobe timeoutMs');
    this.maxOutputBytes = positiveInteger(options.maxOutputBytes ?? 256 * 1024, 'ffprobe maxOutputBytes');
    this.runner = options.runner ?? new NodeFfprobeRunner();
  }

  async probe(filePath: string): Promise<NormalizedMediaMetadata> {
    const raw = await this.runner.run(
      this.binary,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { timeoutMs: this.timeoutMs, maxOutputBytes: this.maxOutputBytes },
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('ffprobe returned invalid JSON');
    }
    return normalizeFfprobeOutput(parsed);
  }
}

export class NodeFfprobeRunner implements FfprobeRunner {
  run(binary: string, args: string[], options: { timeoutMs: number; maxOutputBytes: number }): Promise<string> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(binary, args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let overflow = false;
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, options.timeoutMs);
      timer.unref();

      child.stdout?.on('data', (chunk: Buffer) => {
        if (overflow) return;
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes > options.maxOutputBytes) {
          overflow = true;
          child.kill('SIGKILL');
          return;
        }
        stdoutChunks.push(Buffer.from(chunk));
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        const remaining = Math.max(0, 16 * 1024 - stderrBytes);
        if (!remaining) return;
        const slice = chunk.subarray(0, remaining);
        stderrChunks.push(Buffer.from(slice));
        stderrBytes += slice.byteLength;
      });

      child.once('error', () => {
        clearTimeout(timer);
        reject(new Error('ffprobe process could not be started'));
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        if (timedOut) return reject(new Error('ffprobe timed out'));
        if (overflow) return reject(new Error('ffprobe output exceeded configured limit'));
        if (code !== 0) {
          const detail = Buffer.concat(stderrChunks).toString('utf8').trim();
          return reject(new Error(detail ? `ffprobe failed: ${detail}` : 'ffprobe failed'));
        }
        resolvePromise(Buffer.concat(stdoutChunks).toString('utf8'));
      });
    });
  }
}

export class DerivedAssetFinalizer implements MediaArtifactFinalizer {
  constructor(
    private readonly dependencies: {
      objects: ObjectStore;
      assets: AssetRepository;
      probe: MediaProbe;
      now?: () => Date;
    },
  ) {}

  async finalize(input: MediaArtifactFinalizeInput): Promise<AssetRecord> {
    if (!input.result.uri.startsWith('file:')) {
      throw new Error('derived asset finalizer currently requires a local file URI');
    }

    const filePath = fileURLToPath(input.result.uri);
    const [body, fileStat, media] = await Promise.all([
      readFile(filePath),
      stat(filePath),
      this.dependencies.probe.probe(filePath),
    ]);
    if (!fileStat.isFile()) throw new Error('derived media output is not a regular file');

    const checksumSha256 = createHash('sha256').update(body).digest('hex');
    const transformJson = canonicalTransformJson(input.transform);
    const transformHash = createHash('sha256').update(transformJson).digest('hex');
    const extension = normalizedExtension(filePath, input.transform.output.container);
    const objectKey = buildProjectObjectKey(
      input.projectId,
      input.result.assetId,
      `output.${extension}`,
    );
    const contentType = contentTypeForContainer(input.transform.output.container);

    await this.dependencies.objects.put({
      key: objectKey,
      contentType,
      body: new Uint8Array(body),
      checksumSha256,
    });

    const existing = await this.dependencies.assets.getById(input.result.assetId);
    if (existing) {
      if (existing.projectId !== input.projectId || existing.objectKey !== objectKey) {
        throw new Error(`derived asset identity collision: ${input.result.assetId}`);
      }
      return existing;
    }

    const metadata: Record<string, string | number | boolean> = {
      lineageSourceAssetId: input.sourceAssetId,
      lineageJobId: input.jobId,
      lineageTransformHash: transformHash,
      lineageTransformJson: transformJson,
      lineageExecutor: input.executor,
      manifestVersion: 1,
      outputContainer: input.transform.output.container,
      ...metadataToRecord(media),
    };
    if (input.executorVersion) metadata.lineageExecutorVersion = input.executorVersion;
    if (input.transform.preset) {
      metadata.lineagePresetId = input.transform.preset.id;
      metadata.lineagePresetVersion = input.transform.preset.version;
    }

    const asset: AssetRecord = {
      id: input.result.assetId,
      projectId: input.projectId,
      kind: 'derived-video',
      objectKey,
      contentType,
      bytes: fileStat.size,
      checksumSha256,
      createdAt: (this.dependencies.now?.() ?? new Date()).toISOString(),
      metadata,
    };
    await this.dependencies.assets.create(asset);
    return asset;
  }
}

export function normalizeFfprobeOutput(raw: unknown): NormalizedMediaMetadata {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('unsupported ffprobe response');
  const record = raw as Record<string, unknown>;
  const streams = Array.isArray(record.streams) ? record.streams : [];
  const format = isRecord(record.format) ? record.format : {};
  const video = streams.find((stream) => isRecord(stream) && stream.codec_type === 'video');
  const audio = streams.find((stream) => isRecord(stream) && stream.codec_type === 'audio');

  const metadata: NormalizedMediaMetadata = {};
  const durationSeconds = finiteNumber(format.duration);
  if (durationSeconds !== undefined && durationSeconds >= 0) metadata.durationMs = Math.round(durationSeconds * 1000);

  if (isRecord(video)) {
    const width = positiveWholeNumber(video.width);
    const height = positiveWholeNumber(video.height);
    if (width !== undefined) metadata.width = width;
    if (height !== undefined) metadata.height = height;
    if (typeof video.codec_name === 'string' && video.codec_name.length <= 64) metadata.videoCodec = video.codec_name;
    const fps = parseFrameRate(video.avg_frame_rate ?? video.r_frame_rate);
    if (fps !== undefined) metadata.fps = fps;
  }

  if (isRecord(audio)) {
    if (typeof audio.codec_name === 'string' && audio.codec_name.length <= 64) metadata.audioCodec = audio.codec_name;
    const sampleRate = positiveWholeNumber(audio.sample_rate);
    const channels = positiveWholeNumber(audio.channels);
    if (sampleRate !== undefined) metadata.audioSampleRateHz = sampleRate;
    if (channels !== undefined && channels <= 64) metadata.audioChannels = channels;
  }

  if (!Object.keys(metadata).length) throw new Error('ffprobe response contains no supported media metadata');
  return metadata;
}

export function canonicalTransformJson(transform: Omit<MediaTransformRequest, 'sourceAssetId'>): string {
  return JSON.stringify({
    preset: transform.preset,
    operations: transform.operations,
    output: transform.output,
  });
}

function metadataToRecord(metadata: NormalizedMediaMetadata): Record<string, string | number | boolean> {
  const record: Record<string, string | number | boolean> = {};
  if (metadata.durationMs !== undefined) record.durationMs = metadata.durationMs;
  if (metadata.width !== undefined) record.width = metadata.width;
  if (metadata.height !== undefined) record.height = metadata.height;
  if (metadata.fps !== undefined) record.fps = metadata.fps;
  if (metadata.videoCodec !== undefined) record.videoCodec = metadata.videoCodec;
  if (metadata.audioCodec !== undefined) record.audioCodec = metadata.audioCodec;
  if (metadata.audioSampleRateHz !== undefined) record.audioSampleRateHz = metadata.audioSampleRateHz;
  if (metadata.audioChannels !== undefined) record.audioChannels = metadata.audioChannels;
  return record;
}

function parseFrameRate(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/.exec(value.trim());
  if (!match) return undefined;
  const numerator = Number(match[1]);
  const denominator = match[2] ? Number(match[2]) : 1;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0 || numerator <= 0) return undefined;
  const fps = numerator / denominator;
  if (fps <= 0 || fps > 1000) return undefined;
  return Math.round(fps * 1000) / 1000;
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function positiveWholeNumber(value: unknown): number | undefined {
  const number = finiteNumber(value);
  if (number === undefined || number <= 0 || !Number.isSafeInteger(number)) return undefined;
  return number;
}

function normalizedExtension(filePath: string, container: string): string {
  const fromPath = extname(filePath).replace(/^\./, '').toLowerCase();
  if (/^[a-z0-9]{1,8}$/.test(fromPath)) return fromPath;
  const normalized = container.toLowerCase();
  if (normalized === 'matroska') return 'mkv';
  if (!/^[a-z0-9]{1,8}$/.test(normalized)) throw new Error('unsupported output container extension');
  return normalized;
}

function contentTypeForContainer(container: string): string {
  const normalized = container.toLowerCase();
  if (normalized === 'mp4') return 'video/mp4';
  if (normalized === 'mov') return 'video/quicktime';
  if (normalized === 'webm') return 'video/webm';
  if (normalized === 'mkv' || normalized === 'matroska') return 'video/x-matroska';
  return 'application/octet-stream';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}
