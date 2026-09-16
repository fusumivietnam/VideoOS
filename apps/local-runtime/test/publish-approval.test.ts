import assert from 'node:assert/strict';
import test from 'node:test';

import type { PublishRequest } from '@videoos/contracts';
import type { MediaExecutionPlan } from '../../../services/media-worker/src/index.js';
import { createInMemoryRuntime } from '../src/index.js';

class NoopMediaExecutor {
  async execute(_plan: MediaExecutionPlan) {
    return { assetId: 'unused', uri: 'memory://unused' };
  }
}

class NoopPublisherAdapter {
  readonly network = 'youtube' as const;
  async publish(request: PublishRequest) {
    return request.targets.map((target) => ({ target, status: 'published' as const }));
  }
}

function createApprovalRuntime() {
  return createInMemoryRuntime({
    memberships: [
      { projectId: 'project:one', principalId: 'user:owner', role: 'owner' },
      { projectId: 'project:one', principalId: 'user:editor', role: 'editor' },
      { projectId: 'project:one', principalId: 'user:approver', role: 'admin' },
      { projectId: 'project:two', principalId: 'user:owner', role: 'owner' },
    ],
    mediaExecutor: new NoopMediaExecutor(),
    publisherAdapters: [new NoopPublisherAdapter()],
  });
}

const request: PublishRequest = {
  idempotencyKey: 'approval-test',
  projectId: 'project:one',
  targets: [{ network: 'youtube', accountId: 'account:youtube' }],
  assets: [{ assetId: 'asset:one', uri: 'memory://asset-one.mp4', mimeType: 'video/mp4' }],
  caption: 'approved publish',
};

test('publish requires an explicit publish.manage approver and preserves approval in the internal job payload', async () => {
  const runtime = createApprovalRuntime();
  await runtime.assets.create({
    id: 'asset:one',
    projectId: 'project:one',
    kind: 'source-video',
    objectKey: 'projects/project-one/assets/asset-one/source.mp4',
    contentType: 'video/mp4',
    bytes: 10,
    createdAt: '2026-09-17T00:00:00.000Z',
  });

  const requester = { id: 'user:editor', kind: 'user' as const };

  await assert.rejects(
    runtime.api.createPublish({ principal: requester, request }),
    /publish approval required/,
  );

  await assert.rejects(
    runtime.api.createPublish({
      principal: requester,
      request,
      approval: {
        approvedBy: requester,
        approvedAt: '2026-09-17T00:30:00.000Z',
      },
    }),
    /capability denied: publish.manage/,
  );

  const created = await runtime.api.createPublish({
    principal: requester,
    request,
    approval: {
      approvedBy: { id: 'user:approver', kind: 'user' },
      approvedAt: '2026-09-17T00:31:00.000Z',
    },
  });

  const job = await runtime.jobs.get(created.jobId);
  assert.equal(job?.queue, 'publish');
  assert.deepEqual(job?.payload, {
    projectId: 'project:one',
    request,
    approval: {
      approvedBy: { id: 'user:approver', kind: 'user' },
      approvedAt: '2026-09-17T00:31:00.000Z',
    },
  });
  assert.equal((await runtime.api.getJobStatus(requester, 'project:one', created.jobId))?.status, 'ready');
});

test('publish rejects cross-project assets and invalid schedule timestamps before enqueue', async () => {
  const runtime = createApprovalRuntime();
  await runtime.assets.create({
    id: 'asset:one',
    projectId: 'project:two',
    kind: 'source-video',
    objectKey: 'projects/project-two/assets/asset-one/source.mp4',
    contentType: 'video/mp4',
    bytes: 10,
    createdAt: '2026-09-17T00:00:00.000Z',
  });

  const principal = { id: 'user:owner', kind: 'user' as const };
  const approval = { approvedBy: principal, approvedAt: '2026-09-17T00:31:00.000Z' };

  await assert.rejects(
    runtime.api.createPublish({ principal, request, approval }),
    /publish asset not found in project/,
  );

  const sameProjectAsset = { ...request.assets[0]!, assetId: 'asset:two' };
  await runtime.assets.create({
    id: 'asset:two',
    projectId: 'project:one',
    kind: 'source-video',
    objectKey: 'projects/project-one/assets/asset-two/source.mp4',
    contentType: 'video/mp4',
    bytes: 10,
    createdAt: '2026-09-17T00:00:00.000Z',
  });

  await assert.rejects(
    runtime.api.createPublish({
      principal,
      request: { ...request, idempotencyKey: 'bad-schedule', assets: [sameProjectAsset], scheduledAt: 'tomorrow-ish' },
      approval,
    }),
    /publish scheduledAt is invalid/,
  );
});
