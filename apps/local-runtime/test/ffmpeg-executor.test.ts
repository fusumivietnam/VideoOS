import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import type { MediaExecutionPlan } from '../../../services/media-worker/src/index.js';
import {
  buildFfmpegArgs,
  buildOutputIdentity,
  FfmpegExecutionError,
  FfmpegExecutor,
  type FfmpegProcessRunner,
} from '../src/ffmpeg-executor.js';

function plan(overrides: Partial<MediaExecutionPlan> = {}): MediaExecutionPlan {
  return {
    sourceAssetId: 'asset:source',
    operations: [
      { type: 'trim', startMs: 1_000, endMs: 5_000 },
      { type: 'resize', width: 1280, height: 720, fit: 'cover' },
    ],
    output: { container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', fps: 30 },
    context: {
      projectId: 'project:one',
      jobId: 'media:project-one:1',
      sourceObjectKey: 'projects/project-one/assets/source/source.mp4',
    },
    ...overrides,
  };
}

class WritingRunner implements FfmpegProcessRunner {
  calls: Array<{ binary: string; args: string[]; cwd: string; timeoutMs: number; maxStderrBytes: number }> = [];

  constructor(
    private readonly bytes = new Uint8Array([1, 2, 3]),
    private readonly exitCode = 0,
    private readonly stderr = '',
  ) {}

  async run(
    binary: string,
    args: string[],
    options: { cwd: string; timeoutMs: number; maxStderrBytes: number },
  ) {
    this.calls.push({ binary, args: [...args], ...options });
    const outputPath = args.at(-1);
    if (this.exitCode === 0 && outputPath) {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, this.bytes);
    }
    return { exitCode: this.exitCode, signal: null, stderr: this.stderr };
  }
}

async function withSandbox(run: (root: string, sourcePath: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'videoos-ffmpeg-'));
  const sourcePath = join(root, 'projects/project-one/assets/source/source.mp4');
  await mkdir(dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, new Uint8Array([0, 1, 2, 3]));
  try {
    await run(root, sourcePath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('FFmpeg executor builds typed args, writes deterministic output, and returns stable derived identity', async () => {
  await withSandbox(async (root) => {
    const runner = new WritingRunner();
    const executor = new FfmpegExecutor({ sandboxRoot: root, runner, timeoutMs: 10_000 });
    const executionPlan = plan();

    const first = await executor.execute(executionPlan);
    const second = await executor.execute(executionPlan);
    assert.deepEqual(second, first);
    assert.equal(first.assetId, buildOutputIdentity(executionPlan).assetId);
    assert.match(first.uri, /^file:/);

    assert.equal(runner.calls.length, 2);
    const args = runner.calls[0]?.args ?? [];
    assert.ok(args.includes('-nostdin'));
    assert.ok(args.includes('-ss'));
    assert.ok(args.includes('1.000'));
    assert.ok(args.includes('-t'));
    assert.ok(args.includes('4.000'));
    assert.ok(args.includes('scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720'));
    assert.ok(args.includes('libx264'));
    assert.ok(args.includes('aac'));
    assert.ok(args.includes('mp4'));
  });
});

test('buildFfmpegArgs rejects unsupported subtitle staging and unsafe format values', () => {
  assert.throws(
    () => buildFfmpegArgs(
      plan({ operations: [{ type: 'burn-subtitles', subtitleAssetId: 'asset:subtitle' }] }),
      '/sandbox/source.mp4',
      '/sandbox/output.mp4',
    ),
    (error: unknown) => error instanceof FfmpegExecutionError && error.code === 'unsupported-operation',
  );

  assert.throws(
    () => buildFfmpegArgs(
      plan({ output: { container: 'concat', videoCodec: 'h264' } }),
      '/sandbox/source.mp4',
      '/sandbox/output.bin',
    ),
    (error: unknown) => error instanceof FfmpegExecutionError && error.code === 'unsupported-format',
  );
});

test('FFmpeg executor rejects source symlinks that resolve outside the sandbox', async () => {
  const root = await mkdtemp(join(tmpdir(), 'videoos-ffmpeg-root-'));
  const outside = await mkdtemp(join(tmpdir(), 'videoos-ffmpeg-outside-'));
  const outsideFile = join(outside, 'source.mp4');
  await writeFile(outsideFile, new Uint8Array([1]));
  const sourcePath = join(root, 'projects/project-one/assets/source/source.mp4');
  await mkdir(dirname(sourcePath), { recursive: true });
  await symlink(outsideFile, sourcePath);

  try {
    const runner = new WritingRunner();
    const executor = new FfmpegExecutor({ sandboxRoot: root, runner });
    await assert.rejects(
      executor.execute(plan()),
      (error: unknown) => error instanceof FfmpegExecutionError && error.code === 'unsafe-path',
    );
    assert.equal(runner.calls.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('FFmpeg executor deletes output that exceeds configured size limit', async () => {
  await withSandbox(async (root) => {
    const runner = new WritingRunner(new Uint8Array(32));
    const executor = new FfmpegExecutor({ sandboxRoot: root, runner, maxOutputBytes: 8 });
    await assert.rejects(
      executor.execute(plan()),
      (error: unknown) => error instanceof FfmpegExecutionError && error.code === 'output-too-large',
    );
  });
});

test('FFmpeg executor normalizes non-zero process failures', async () => {
  await withSandbox(async (root) => {
    const executor = new FfmpegExecutor({
      sandboxRoot: root,
      runner: new WritingRunner(new Uint8Array(), 1, 'decoder failed'),
    });
    await assert.rejects(
      executor.execute(plan()),
      (error: unknown) => error instanceof FfmpegExecutionError
        && error.code === 'process-failed'
        && /decoder failed/.test(error.message),
    );
  });
});
