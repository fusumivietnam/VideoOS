import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { InMemoryMembershipRepository } from '@videoos/identity';
import { InMemoryJobQueue } from '@videoos/job-queue';
import { InMemoryAssetRepository } from '@videoos/storage';
import { VideoOsApi } from '../../../services/api/src/index.js';
import { createProductBffServer } from '../src/product-bff.js';
import {
  createProductAuthConfig,
  issueProductSession,
  productSessionCookie,
  type ProductAuthConfig,
} from '../src/product-auth.js';

const auth: ProductAuthConfig = {
  identities: [
    { principalId: 'user:a', accessCode: 'alpha-user-a-secret' },
    { principalId: 'user:b', accessCode: 'alpha-user-b-secret' },
  ],
  sessionSecret: 's'.repeat(48),
  ttlSeconds: 3600,
  secureCookie: false,
};

async function fixture() {
  const memberships = new InMemoryMembershipRepository([
    { projectId: 'project:a', principalId: 'user:a', role: 'owner' },
    { projectId: 'project:b', principalId: 'user:b', role: 'viewer' },
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
  await jobs.enqueue('media', 'job:a', { projectId: 'project:a', assetId: 'asset:a' });
  await jobs.enqueue('media', 'job:b', { projectId: 'project:b', assetId: 'asset:b' });
  const api = new VideoOsApi({ memberships, assets, jobs });
  const server = createProductBffServer(api, auth);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server address unavailable');
  return { server, base: `http://127.0.0.1:${address.port}`, jobs };
}

function firstCookie(value: string): string {
  const cookie = value.split(';')[0];
  if (!cookie) throw new Error('empty cookie');
  return cookie;
}

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('missing set-cookie');
  return firstCookie(setCookie);
}

async function login(base: string, accessCode: string): Promise<string> {
  const response = await fetch(`${base}/api/product/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accessCode }),
  });
  assert.equal(response.status, 200);
  return cookieFrom(response);
}

function mediaJobBody(assetId: string, jobId: string) {
  return {
    assetId,
    jobId,
    transform: {
      operations: [{ type: 'resize', width: 1280, height: 720, fit: 'contain' }],
      output: { container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', width: 1280, height: 720, fps: 30 },
    },
  };
}

test('product auth config fails closed on partial config and validates identities', () => {
  assert.throws(() => createProductAuthConfig({ VIDEOOS_PRODUCT_SESSION_SECRET: 'x'.repeat(40) }), /requires/);
  assert.throws(() => createProductAuthConfig({
    VIDEOOS_PRODUCT_IDENTITIES_JSON: '[]',
    VIDEOOS_PRODUCT_SESSION_SECRET: 'x'.repeat(40),
  }), /between 1 and 100/);
});

test('health is public but product routes require authentication', async (t) => {
  const { server, base } = await fixture();
  t.after(() => server.close());
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/api/product/me/projects`)).status, 401);
});

test('login issues HttpOnly session and project discovery is principal scoped', async (t) => {
  const { server, base } = await fixture();
  t.after(() => server.close());

  const invalid = await fetch(`${base}/api/product/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessCode: 'wrong' }),
  });
  assert.equal(invalid.status, 401);

  const response = await fetch(`${base}/api/product/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessCode: 'alpha-user-a-secret' }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie') ?? '', /HttpOnly/);
  assert.match(response.headers.get('set-cookie') ?? '', /SameSite=Strict/);
  const cookie = cookieFrom(response);

  const projects = await fetch(`${base}/api/product/me/projects`, { headers: { cookie } });
  assert.equal(projects.status, 200);
  assert.deepEqual(await projects.json(), {
    principalId: 'user:a',
    projects: [{ projectId: 'project:a', role: 'owner' }],
  });
});

test('assets and jobs preserve project authorization and cross-project isolation', async (t) => {
  const { server, base } = await fixture();
  t.after(() => server.close());
  const cookie = await login(base, 'alpha-user-a-secret');

  const assets = await fetch(`${base}/api/product/projects/project%3Aa/assets`, { headers: { cookie } });
  assert.equal(assets.status, 200);
  const assetBody = await assets.json() as { assets: Array<{ id: string }> };
  assert.deepEqual(assetBody.assets.map((asset) => asset.id), ['asset:a']);

  assert.equal((await fetch(`${base}/api/product/projects/project%3Ab/assets`, { headers: { cookie } })).status, 403);

  const ownJob = await fetch(`${base}/api/product/projects/project%3Aa/jobs/job%3Aa`, { headers: { cookie } });
  assert.equal(ownJob.status, 200);
  assert.equal(((await ownJob.json()) as { job: { jobId: string } }).job.jobId, 'job:a');

  const foreignJobId = await fetch(`${base}/api/product/projects/project%3Aa/jobs/job%3Ab`, { headers: { cookie } });
  assert.equal(foreignJobId.status, 200);
  assert.equal(((await foreignJobId.json()) as { job: unknown }).job, null);
});

test('owner can create a bounded project-scoped media job', async (t) => {
  const { server, base, jobs } = await fixture();
  t.after(() => server.close());
  const cookie = await login(base, 'alpha-user-a-secret');

  const response = await fetch(`${base}/api/product/projects/project%3Aa/media-jobs`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(mediaJobBody('asset:a', 'job:new')),
  });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { jobId: 'job:new' });
  const queued = await jobs.get<{ projectId: string; assetId: string }>('job:new');
  assert.equal(queued?.queue, 'media');
  assert.equal(queued?.payload.projectId, 'project:a');
  assert.equal(queued?.payload.assetId, 'asset:a');
});

test('media mutation preserves capability and asset project boundaries', async (t) => {
  const { server, base } = await fixture();
  t.after(() => server.close());

  const viewerCookie = await login(base, 'alpha-user-b-secret');
  const viewerAttempt = await fetch(`${base}/api/product/projects/project%3Ab/media-jobs`, {
    method: 'POST',
    headers: { cookie: viewerCookie, 'content-type': 'application/json' },
    body: JSON.stringify(mediaJobBody('asset:b', 'job:viewer')),
  });
  assert.equal(viewerAttempt.status, 403);

  const ownerCookie = await login(base, 'alpha-user-a-secret');
  const crossProjectAsset = await fetch(`${base}/api/product/projects/project%3Aa/media-jobs`, {
    method: 'POST',
    headers: { cookie: ownerCookie, 'content-type': 'application/json' },
    body: JSON.stringify(mediaJobBody('asset:b', 'job:cross')),
  });
  assert.equal(crossProjectAsset.status, 404);
});

test('media mutation rejects malformed or unbounded transforms', async (t) => {
  const { server, base } = await fixture();
  t.after(() => server.close());
  const cookie = await login(base, 'alpha-user-a-secret');

  const tooLarge = mediaJobBody('asset:a', 'job:bad');
  tooLarge.transform.output.width = 100_000;
  assert.equal((await fetch(`${base}/api/product/projects/project%3Aa/media-jobs`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(tooLarge),
  })).status, 400);

  const unsafeCodec = mediaJobBody('asset:a', 'job:bad2');
  unsafeCodec.transform.output.videoCodec = 'h264 -i /etc/passwd';
  assert.equal((await fetch(`${base}/api/product/projects/project%3Aa/media-jobs`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(unsafeCodec),
  })).status, 400);
});

test('tampered and expired product sessions are rejected', async (t) => {
  const { server, base } = await fixture();
  t.after(() => server.close());

  const token = issueProductSession('user:a', auth, Date.now());
  const validCookie = firstCookie(productSessionCookie(token, auth));
  const tamperedCookie = `${validCookie.slice(0, -1)}x`;
  assert.equal((await fetch(`${base}/api/product/me/projects`, { headers: { cookie: tamperedCookie } })).status, 401);

  const expired = issueProductSession('user:a', auth, Date.now() - (auth.ttlSeconds + 1) * 1000);
  const expiredCookie = firstCookie(productSessionCookie(expired, auth));
  assert.equal((await fetch(`${base}/api/product/me/projects`, {
    headers: { cookie: expiredCookie },
  })).status, 401);
});
