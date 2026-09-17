import assert from 'node:assert/strict';
import test from 'node:test';

import { FakeNetworkPublisherAdapter } from '../../../services/publisher/src/index.js';
import { createInMemoryRuntime } from '../src/index.js';
import { loadRuntimeConfig } from '../src/runtime-config.js';

test('runtime config defaults local/test publishing to fake and production to youtube', () => {
  assert.equal(loadRuntimeConfig({ NODE_ENV: 'development' }).publisher.driver, 'fake');
  assert.equal(loadRuntimeConfig({ NODE_ENV: 'test' }).publisher.driver, 'fake');
  assert.equal(loadRuntimeConfig({ NODE_ENV: 'production' }).publisher.driver, 'youtube');

  const explicit = loadRuntimeConfig({
    NODE_ENV: 'test',
    VIDEOOS_PUBLISHER_DRIVER: 'youtube',
    VIDEOOS_WEB_HOST: 'localhost',
    VIDEOOS_WEB_PORT: '4100',
    VIDEOOS_PRODUCT_BFF_PORT: '4101',
  });
  assert.equal(explicit.publisher.driver, 'youtube');
  assert.equal(explicit.web.port, 4100);
  assert.equal(explicit.productBff.port, 4101);
});

test('runtime config fails fast on invalid deployment values', () => {
  assert.throws(() => loadRuntimeConfig({ NODE_ENV: 'staging' }), /invalid NODE_ENV/);
  assert.throws(() => loadRuntimeConfig({ VIDEOOS_PUBLISHER_DRIVER: 'auto' }), /invalid VIDEOOS_PUBLISHER_DRIVER/);
  assert.throws(() => loadRuntimeConfig({ VIDEOOS_WEB_PORT: '70000' }), /invalid port/);
  assert.throws(() => loadRuntimeConfig({ VIDEOOS_WEB_HOST: 'http:\/\/bad' }), /invalid host/);
});

test('approved publish job completes end to end through the fake publisher without external credentials', async () => {
  const owner = { id: 'user:owner', kind: 'user' as const };
  const runtime = createInMemoryRuntime({
    memberships: [{ projectId: 'project:demo', principalId: owner.id, role: 'owner' }],
    mediaExecutor: {
      async execute() {
        return { assetId: 'unused', uri: 'memory://unused' };
      },
    },
    publisherAdapters: [new FakeNetworkPublisherAdapter({ network: 'youtube' })],
  });

  await runtime.assets.create({
    id: 'asset:video',
    projectId: 'project:demo',
    kind: 'source-video',
    objectKey: 'video.mp4',
    contentType: 'video/mp4',
    bytes: 1024,
    createdAt: '2026-09-17T00:00:00.000Z',
  });

  const result = await runtime.api.createPublish({
    principal: owner,
    approval: { approvedBy: owner, approvedAt: '2026-09-17T00:00:01.000Z' },
    request: {
      idempotencyKey: 'demo-publish-1',
      projectId: 'project:demo',
      targets: [{ network: 'youtube', accountId: 'account:demo' }],
      assets: [{ assetId: 'asset:video', uri: 'memory://video.mp4', mimeType: 'video/mp4' }],
      caption: 'VideoOS fake publish smoke',
    },
  });

  const before = await runtime.jobs.get(result.jobId);
  assert.equal(before?.status, 'queued');

  const ran = await runtime.runPublishOnce();
  assert.equal(ran, true);

  const after = await runtime.jobs.get(result.jobId);
  assert.equal(after?.status, 'succeeded');
  assert.equal(after?.attempts, 1);
});
