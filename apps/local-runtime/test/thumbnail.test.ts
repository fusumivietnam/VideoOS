import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { InMemoryAssetRepository, InMemoryObjectStore } from '@videoos/storage';
import type { MediaExecutionPlan, MediaExecutor } from '../../../services/media-worker/src/index.js';
import { LocalMediaNodeAgent } from '../src/local-node-media-executor.js';
import type { MediaProbe } from '../src/media-artifact.js';
import { RoutedMediaArtifactFinalizer, ThumbnailAssetFinalizer } from '../src/thumbnail-artifact.js';
import {
  buildThumbnailArgs,
  buildThumbnailIdentity,
  REPRESENTATIVE_FRAME_DEFAULT_MS,
  RoutedMediaExecutor,
  ThumbnailFfmpegExecutor,
} from '../src/thumbnail-executor.js';

function thumbnailPlan(atMs?: number): MediaExecutionPlan {
  return {
    sourceAssetId: 'asset:source',
    frame: { ...(atMs !== undefined ? { atMs } : {}), width: 640, height: 360 },
    operations: [],
    output: { container: 'jpg' },
    context: {
      projectId: 'project:one',
      jobId: 'thumb:one',
      sourceObjectKey: 'projects/project:one/assets/asset:source/source.mp4',
    },
  };
}

test('thumbnail arguments use explicit timestamp and bounded single-frame output', () => {
  const args = buildThumbnailArgs(thumbnailPlan(2_500), '/sandbox/source.mp4', '/sandbox/out.jpg');
  assert.deepEqual(args, [
    '-nostdin', '-hide_banner', '-loglevel', 'error',
    '-ss', '2.500', '-i', '/sandbox/source.mp4',
    '-frames:v', '1', '-an',
    '-vf', 'scale=640:360:force_original_aspect_ratio=decrease',
    '-f', 'image2', '-y', '/sandbox/out.jpg',
  ]);
});

test('representative-frame default is deterministic when timestamp is omitted', () => {
  const args = buildThumbnailArgs(thumbnailPlan(), '/sandbox/source.mp4', '/sandbox/out.jpg');
  const seekIndex = args.indexOf('-ss');
  assert.equal(REPRESENTATIVE_FRAME_DEFAULT_MS, 1_000);
  assert.equal(args[seekIndex + 1], '1.000');
});

test('frame configuration participates in deterministic thumbnail identity', () => {
  assert.notEqual(buildThumbnailIdentity(thumbnailPlan(500)).assetId, buildThumbnailIdentity(thumbnailPlan(1_500)).assetId);
});

test('thumbnail executor creates deterministic image result inside sandbox', async () => {
  const root = await mkdtemp(join(tmpdir(), 'videoos-thumbnail-'));
  const sourceDir = resolve(root, 'projects/project:one/assets/asset:source');
  const source = resolve(sourceDir, 'source.mp4');
  await mkdir(sourceDir, { recursive: true });
  await writeFile(source, new Uint8Array([1, 2, 3]));

  try {
    const executor = new ThumbnailFfmpegExecutor({
      sandboxRoot: root,
      runner: {
        async run(_binary, args) {
          const outputPath = args.at(-1);
          assert.ok(outputPath);
          await writeFile(outputPath, new Uint8Array([9, 8, 7]));
          return { exitCode: 0, signal: null, stderr: '' };
        },
      },
    });
    const first = await executor.execute(thumbnailPlan());
    const second = await executor.execute(thumbnailPlan());
    assert.deepEqual(second, first);
    assert.match(first.assetId, /^asset:derived:/);
    assert.match(first.uri, /\.jpg$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('thumbnail finalizer persists image asset with checksum and representative-frame lineage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'videoos-thumbnail-finalizer-'));
  const output = join(root, 'thumbnail.jpg');
  await writeFile(output, new Uint8Array([4, 5, 6]));
  const assets = new InMemoryAssetRepository();
  const objects = new InMemoryObjectStore();
  const probe: MediaProbe = { async probe() { return { width: 640, height: 360, videoCodec: 'mjpeg' }; } };
  const finalizer = new ThumbnailAssetFinalizer({ assets, objects, probe, now: () => new Date('2026-09-16T00:00:00.000Z') });

  try {
    const asset = await finalizer.finalize({
      projectId: 'project:one',
      jobId: 'thumb:one',
      sourceAssetId: 'asset:source',
      transform: { frame: {}, operations: [], output: { container: 'jpg' } },
      result: { assetId: 'asset:derived:thumb', uri: pathToFileURL(output).href },
      executor: 'ffmpeg-thumbnail',
      executorVersion: '7.1',
    });
    assert.equal(asset.kind, 'image');
    assert.equal(asset.contentType, 'image/jpeg');
    assert.equal(asset.metadata?.frameAtMs, REPRESENTATIVE_FRAME_DEFAULT_MS);
    assert.equal(asset.metadata?.width, 640);
    assert.equal(asset.metadata?.height, 360);
    assert.equal(asset.metadata?.imageCodec, 'mjpeg');
    assert.equal(asset.metadata?.lineageSourceAssetId, 'asset:source');
    assert.match(String(asset.metadata?.lineageTransformJson), /"frame":\{\}/);
    assert.equal(typeof asset.checksumSha256, 'string');
    assert.deepEqual(await objects.get(asset.objectKey), new Uint8Array([4, 5, 6]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('media executor router and local-node agent use the same thumbnail executor path', async () => {
  const routes: string[] = [];
  const video: MediaExecutor = { async execute() { routes.push('video'); return { assetId: 'video', uri: 'file:///video.mp4' }; } };
  const thumbnail: MediaExecutor = { async execute() { routes.push('thumbnail'); return { assetId: 'thumb', uri: 'file:///thumb.jpg' }; } };
  const router = new RoutedMediaExecutor(video, thumbnail);

  assert.deepEqual(await router.execute(thumbnailPlan()), { assetId: 'thumb', uri: 'file:///thumb.jpg' });
  const agent = new LocalMediaNodeAgent({ nodeId: 'node:one', executor: router, executorName: 'routed-media' });
  const result = await agent.execute({
    leaseId: 'lease:thumb', taskId: 'thumb:node', nodeId: 'node:one', projectId: 'project:one',
    payload: {
      kind: 'media-transform',
      request: { sourceAssetId: 'asset:source', frame: { atMs: 500 }, operations: [], output: { container: 'png' } },
      sourceObjectKey: 'projects/project:one/assets/asset:source/source.mp4',
    },
    leasedAt: '2026-09-16T00:00:00.000Z', expiresAt: '2999-01-01T00:00:00.000Z',
  });
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(routes, ['thumbnail', 'thumbnail']);
});

test('artifact finalizer router selects thumbnail finalization for frame mode', async () => {
  const calls: string[] = [];
  const fakeRecord = {
    id: 'asset:test', projectId: 'project:one', kind: 'image' as const,
    objectKey: 'projects/project:one/assets/asset:test/test.jpg', contentType: 'image/jpeg', bytes: 1,
    createdAt: '2026-09-16T00:00:00.000Z',
  };
  const videoFinalizer = { async finalize() { calls.push('video'); return { ...fakeRecord, kind: 'derived-video' as const }; } };
  const thumbnailFinalizer = { async finalize() { calls.push('thumbnail'); return fakeRecord; } };
  const routed = new RoutedMediaArtifactFinalizer(videoFinalizer, thumbnailFinalizer);
  await routed.finalize({
    projectId: 'project:one', jobId: 'job:one', sourceAssetId: 'asset:source',
    transform: { frame: {}, operations: [], output: { container: 'jpg' } },
    result: { assetId: 'asset:test', uri: 'file:///tmp/test.jpg' }, executor: 'thumbnail',
  });
  assert.deepEqual(calls, ['thumbnail']);
});
