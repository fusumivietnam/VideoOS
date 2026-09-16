import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { InMemoryAssetRepository, InMemoryObjectStore } from '@videoos/storage';
import {
  canonicalTransformJson,
  DerivedAssetFinalizer,
  normalizeFfprobeOutput,
  type MediaProbe,
} from '../src/media-artifact.js';

test('ffprobe output is normalized into bounded workflow metadata', () => {
  const metadata = normalizeFfprobeOutput({
    format: { duration: '12.345' },
    streams: [
      {
        codec_type: 'video',
        codec_name: 'h264',
        width: 1920,
        height: 1080,
        avg_frame_rate: '30000/1001',
      },
      {
        codec_type: 'audio',
        codec_name: 'aac',
        sample_rate: '48000',
        channels: 2,
      },
    ],
  });

  assert.deepEqual(metadata, {
    durationMs: 12_345,
    width: 1920,
    height: 1080,
    fps: 29.97,
    videoCodec: 'h264',
    audioCodec: 'aac',
    audioSampleRateHz: 48_000,
    audioChannels: 2,
  });
});

test('ffprobe normalization rejects responses without supported media metadata', () => {
  assert.throws(() => normalizeFfprobeOutput({ streams: [], format: {} }), /no supported media metadata/);
  assert.throws(() => normalizeFfprobeOutput('not-an-object'), /unsupported ffprobe response/);
});

test('derived asset finalizer persists object bytes and reproducible lineage idempotently', async () => {
  const root = await mkdtemp(join(tmpdir(), 'videoos-derived-'));
  const outputPath = join(root, 'output.mp4');
  const outputBytes = new Uint8Array([1, 3, 3, 7]);
  await writeFile(outputPath, outputBytes);

  const objects = new InMemoryObjectStore();
  const assets = new InMemoryAssetRepository();
  const probe: MediaProbe = {
    async probe() {
      return {
        durationMs: 4_000,
        width: 1280,
        height: 720,
        fps: 30,
        videoCodec: 'h264',
        audioCodec: 'aac',
      };
    },
  };
  const finalizer = new DerivedAssetFinalizer({
    objects,
    assets,
    probe,
    now: () => new Date('2026-09-16T00:00:00.000Z'),
  });
  const transform = {
    operations: [{ type: 'resize' as const, width: 1280, height: 720, fit: 'cover' as const }],
    output: { container: 'mp4', videoCodec: 'h264', audioCodec: 'aac' },
  };
  const input = {
    projectId: 'project:one',
    jobId: 'media:project-one:1',
    sourceAssetId: 'asset:source',
    transform,
    result: { assetId: 'asset:derived:123', uri: pathToFileURL(outputPath).href },
    executor: 'ffmpeg',
    executorVersion: 'test-version',
  };

  try {
    const first = await finalizer.finalize(input);
    const second = await finalizer.finalize(input);
    assert.deepEqual(second, first);
    assert.equal(first.kind, 'derived-video');
    assert.equal(first.objectKey, 'projects/project:one/assets/asset:derived:123/output.mp4');
    assert.equal(first.bytes, 4);
    assert.equal(first.createdAt, '2026-09-16T00:00:00.000Z');
    assert.equal(first.metadata?.lineageSourceAssetId, 'asset:source');
    assert.equal(first.metadata?.lineageJobId, 'media:project-one:1');
    assert.equal(first.metadata?.lineageExecutor, 'ffmpeg');
    assert.equal(first.metadata?.lineageExecutorVersion, 'test-version');
    assert.equal(first.metadata?.lineageTransformJson, canonicalTransformJson(transform));
    assert.equal(typeof first.metadata?.lineageTransformHash, 'string');
    assert.equal(first.metadata?.durationMs, 4_000);
    assert.equal(first.metadata?.width, 1280);
    assert.equal(first.metadata?.height, 720);
    assert.equal(first.metadata?.fps, 30);
    assert.deepEqual(await objects.get(first.objectKey), outputBytes);
    assert.equal((await assets.listByProject('project:one')).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('derived asset finalizer rejects non-local execution results before persistence', async () => {
  const finalizer = new DerivedAssetFinalizer({
    objects: new InMemoryObjectStore(),
    assets: new InMemoryAssetRepository(),
    probe: { async probe() { return { durationMs: 1 }; } },
  });

  await assert.rejects(
    finalizer.finalize({
      projectId: 'project:one',
      jobId: 'job:one',
      sourceAssetId: 'asset:source',
      transform: { operations: [], output: { container: 'mp4' } },
      result: { assetId: 'asset:derived', uri: 'memory://result' },
      executor: 'ffmpeg',
    }),
    /requires a local file URI/,
  );
});
