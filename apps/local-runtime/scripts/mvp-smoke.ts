import { composePublisherAdapters } from '../src/publisher-composition.js';
import { loadRuntimeConfig } from '../src/runtime-config.js';
import { createInMemoryRuntime } from '../src/index.js';

const owner = { id: 'user:mvp-smoke', kind: 'user' as const };
const projectId = 'project:mvp-smoke';
const assetId = 'asset:mvp-smoke-video';

const config = loadRuntimeConfig({
  NODE_ENV: 'test',
  VIDEOOS_PUBLISHER_DRIVER: 'fake',
});

const runtime = createInMemoryRuntime({
  memberships: [{ projectId, principalId: owner.id, role: 'owner' }],
  mediaExecutor: {
    async execute() {
      return { assetId: 'asset:unused', uri: 'memory://unused' };
    },
  },
  publisherAdapters: composePublisherAdapters(config),
});

await runtime.assets.create({
  id: assetId,
  projectId,
  kind: 'source-video',
  objectKey: 'mvp-smoke/video.mp4',
  contentType: 'video/mp4',
  bytes: 1024,
  createdAt: new Date().toISOString(),
});

const request = {
  idempotencyKey: 'mvp-smoke-publish-1',
  projectId,
  targets: [{ network: 'youtube' as const, accountId: 'account:mvp-smoke' }],
  assets: [{ assetId, uri: 'memory://mvp-smoke/video.mp4', mimeType: 'video/mp4' }],
  caption: 'VideoOS MVP smoke publish',
};

const preflight = await runtime.api.preflightPublish(owner, request);
if (!preflight.approvalRequired) throw new Error('MVP smoke expected approval to be required');

const created = await runtime.api.createPublish({
  principal: owner,
  approval: { approvedBy: owner, approvedAt: new Date().toISOString() },
  request,
});

const ready = await runtime.jobs.get(created.jobId);
if (ready?.status !== 'ready') throw new Error(`MVP smoke expected ready publish job, got ${ready?.status ?? 'missing'}`);

const lifecycle = await runtime.runPublishOnce();
if (!lifecycle || lifecycle.kind !== 'completed' || lifecycle.jobId !== created.jobId) {
  throw new Error('MVP smoke publish worker did not complete the expected job');
}

const completed = await runtime.jobs.get(created.jobId);
if (completed?.status !== 'completed') {
  throw new Error(`MVP smoke expected completed publish job, got ${completed?.status ?? 'missing'}`);
}

console.log(JSON.stringify({
  ok: true,
  mode: config.mode,
  publisherDriver: config.publisher.driver,
  projectId,
  assetId,
  publishJobId: created.jobId,
  finalStatus: completed.status,
  attempts: completed.attempts,
}, null, 2));
