import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { InMemoryMembershipRepository } from '@videoos/identity';
import { InMemoryJobQueue } from '@videoos/job-queue';
import { InMemoryAssetRepository } from '@videoos/storage';
import { VideoOsApi } from '../../../services/api/src/index.js';
import { createProductBffServer } from '../src/product-bff.js';
import type { ProductAuthConfig } from '../src/product-auth.js';

const auth: ProductAuthConfig = {
  identities: [
    { principalId: 'user:owner', accessCode: 'owner-secret-code' },
    { principalId: 'user:viewer', accessCode: 'viewer-secret-code' },
  ],
  sessionSecret: 'p'.repeat(48),
  ttlSeconds: 3600,
  secureCookie: false,
};

async function fixture() {
  const memberships = new InMemoryMembershipRepository([
    { projectId: 'project:a', principalId: 'user:owner', role: 'owner' },
    { projectId: 'project:b', principalId: 'user:viewer', role: 'viewer' },
  ]);
  const assets = new InMemoryAssetRepository();
  const jobs = new InMemoryJobQueue();
  await assets.create({
    id: 'asset:a', projectId: 'project:a', kind: 'source-video', objectKey: 'a.mp4', contentType: 'video/mp4', bytes: 10,
    createdAt: '2026-09-17T00:00:00.000Z',
  });
  await assets.create({
    id: 'asset:b', projectId: 'project:b', kind: 'source-video', objectKey: 'b.mp4', contentType: 'video/mp4', bytes: 20,
    createdAt: '2026-09-17T00:00:00.000Z',
  });
  const server = createProductBffServer(new VideoOsApi({ memberships, assets, jobs }), auth);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server address unavailable');
  return { server, base: `http://127.0.0.1:${address.port}`, jobs };
}

async function login(base: string, accessCode: string): Promise<string> {
  const response = await fetch(`${base}/api/product/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accessCode }),
  });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie);
  const cookie = setCookie.split(';')[0];
  assert.ok(cookie);
  return cookie;
}

function body(assetId = 'asset:a') {
  return {
    assetId,
    accountId: 'youtube-account-1',
    idempotencyKey: 'preflight-1',
    mimeType: 'video/mp4',
    caption: 'VideoOS publish preflight',
  };
}

test('publish preflight validates a bounded YouTube request without enqueueing', async (t) => {
  const { server, base, jobs } = await fixture();
  t.after(() => server.close());
  const cookie = await login(base, 'owner-secret-code');

  const response = await fetch(`${base}/api/product/projects/project%3Aa/publish-preflight`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body()),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    projectId: 'project:a',
    assetCount: 1,
    targetCount: 1,
    scheduled: false,
    approvalRequired: true,
    provider: 'youtube',
    enqueueAllowed: false,
  });
  assert.equal(await jobs.get('publish:project:a:preflight-1'), null);
});

test('publish preflight preserves project capability and asset isolation', async (t) => {
  const { server, base } = await fixture();
  t.after(() => server.close());

  const viewer = await login(base, 'viewer-secret-code');
  const denied = await fetch(`${base}/api/product/projects/project%3Ab/publish-preflight`, {
    method: 'POST',
    headers: { cookie: viewer, 'content-type': 'application/json' },
    body: JSON.stringify(body('asset:b')),
  });
  assert.equal(denied.status, 403);

  const owner = await login(base, 'owner-secret-code');
  const crossProject = await fetch(`${base}/api/product/projects/project%3Aa/publish-preflight`, {
    method: 'POST',
    headers: { cookie: owner, 'content-type': 'application/json' },
    body: JSON.stringify(body('asset:b')),
  });
  assert.equal(crossProject.status, 404);
});

test('publish preflight rejects malformed schedule and unbounded caption', async (t) => {
  const { server, base } = await fixture();
  t.after(() => server.close());
  const cookie = await login(base, 'owner-secret-code');

  const invalidSchedule = { ...body(), scheduledAt: 'tomorrow-ish' };
  assert.equal((await fetch(`${base}/api/product/projects/project%3Aa/publish-preflight`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(invalidSchedule),
  })).status, 400);

  const hugeCaption = { ...body(), caption: 'x'.repeat(5001) };
  assert.equal((await fetch(`${base}/api/product/projects/project%3Aa/publish-preflight`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(hugeCaption),
  })).status, 400);
});
