import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';

import { InMemoryAssetRepository, InMemoryObjectStore } from '@videoos/storage';
import { buildFfmpegArgs, buildOutputIdentity } from '../src/ffmpeg-executor.js';
import { compileMediaPreset } from '../src/media-presets.js';
import { ObjectStoreSubtitleStager } from '../src/subtitle-stager.js';

for (const [presetId, width, height] of [
  ['vertical-short', 1080, 1920],
  ['landscape-hd', 1920, 1080],
  ['square-social', 1080, 1080],
] as const) {
  test(`preset ${presetId} compiles deterministically`, () => {
    const first = compileMediaPreset('asset:source', presetId);
    const second = compileMediaPreset('asset:source', presetId);
    assert.deepEqual(second, first);
    assert.deepEqual(first.preset, { id: presetId, version: 1 });
    assert.deepEqual(first.operations[0], { type: 'resize', width, height, fit: 'cover' });
    assert.equal(first.output.width, width);
    assert.equal(first.output.height, height);
    assert.equal(first.output.videoCodec, 'h264');
    assert.equal(first.output.audioCodec, 'aac');
  });
}

test('preset identity contributes to deterministic output identity', () => {
  const base = compileMediaPreset('asset:source', 'vertical-short');
  const context = {
    projectId: 'project:one',
    jobId: 'job:one',
    sourceObjectKey: 'projects/project:one/assets/asset:source/source.mp4',
  };
  const first = buildOutputIdentity({ ...base, context });
  const changed = buildOutputIdentity({ ...base, preset: { id: 'vertical-short', version: 2 }, context });
  assert.notEqual(first.assetId, changed.assetId);
});

test('subtitle asset is staged from object storage into the execution sandbox', async () => {
  const root = await mkdtemp(join(tmpdir(), 'videoos-subtitles-'));
  const assets = new InMemoryAssetRepository();
  const objects = new InMemoryObjectStore();
  const objectKey = 'projects/project:one/assets/subtitle:one/captions.srt';
  const body = new TextEncoder().encode('1\n00:00:00,000 --> 00:00:01,000\nHello\n');

  await assets.create({
    id: 'subtitle:one',
    projectId: 'project:one',
    kind: 'subtitle',
    objectKey,
    contentType: 'application/x-subrip',
    bytes: body.byteLength,
    createdAt: '2026-09-16T00:00:00.000Z',
  });
  await objects.put({ key: objectKey, contentType: 'application/x-subrip', body });

  try {
    const stager = new ObjectStoreSubtitleStager({ assets, objects, sandboxRoot: root });
    const plan = {
      ...compileMediaPreset('asset:source', 'vertical-short', { subtitleAssetId: 'subtitle:one' }),
      context: {
        projectId: 'project:one',
        jobId: 'job:one',
        sourceObjectKey: 'projects/project:one/assets/asset:source/source.mp4',
      },
    };
    const staged = await stager.stage('subtitle:one', plan);
    assert.equal(relative(root, staged).startsWith('..'), false);
    assert.equal((await readFile(staged)).toString('utf8'), new TextDecoder().decode(body));

    const args = buildFfmpegArgs(plan, '/sandbox/input.mp4', '/sandbox/output.mp4', new Map([['subtitle:one', staged]]));
    const filterIndex = args.indexOf('-vf');
    assert.notEqual(filterIndex, -1);
    assert.match(args[filterIndex + 1] ?? '', /subtitles='/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('subtitle staging rejects cross-project assets and enforces size limits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'videoos-subtitles-'));
  const assets = new InMemoryAssetRepository();
  const objects = new InMemoryObjectStore();
  const objectKey = 'projects/project:two/assets/subtitle:two/captions.srt';
  const body = new Uint8Array([1, 2, 3]);
  await assets.create({
    id: 'subtitle:two',
    projectId: 'project:two',
    kind: 'subtitle',
    objectKey,
    contentType: 'application/x-subrip',
    bytes: body.byteLength,
    createdAt: '2026-09-16T00:00:00.000Z',
  });
  await objects.put({ key: objectKey, contentType: 'application/x-subrip', body });

  try {
    const stager = new ObjectStoreSubtitleStager({ assets, objects, sandboxRoot: root, maxSubtitleBytes: 2 });
    const plan = {
      ...compileMediaPreset('asset:source', 'vertical-short'),
      context: {
        projectId: 'project:one',
        jobId: 'job:one',
        sourceObjectKey: 'projects/project:one/assets/asset:source/source.mp4',
      },
    };
    await assert.rejects(stager.stage('subtitle:two', plan), /not found in project/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
