import assert from 'node:assert/strict';
import test from 'node:test';

import type { MediaTransformRequest, PublishRequest } from '@videoos/contracts';
import { createInMemoryRuntime } from '../src/index.js';

class FakeMediaExecutor {
  readonly plans: Array<{
    sourceAssetId: string;
    operations: MediaTransformRequest['operations'];
    output: MediaTransformRequest['output'];
  }> = [];

  async execute(plan: {
    sourceAssetId: string;
    operations: MediaTransformRequest['operations'];
    output: MediaTransformRequest['output'];
  }) {
    this.plans.push(structuredClone(plan));
    return { assetId: 'asset:derived', uri: 'memory://asset-derived.mp4' };
  }
}

class FakeYoutubeAdapter {
  readonly network = 'youtube' as const;
  readonly requests: PublishRequest[] = [];

  async publish(request: PublishRequest) {
    this.requests.push(structuredClone(request));
    return request.targets.map((target, index) => ({
      target,
      externalPostId: `youtube:${index + 1}`,
      externalUrl: `https://example.invalid/youtube/${index + 1}`,
      status: 'published' as const,
    }));
  }
}

test('local runtime executes media and publish jobs end to end', async () => {
  const mediaExecutor = new FakeMediaExecutor();
  const youtube = new FakeYoutubeAdapter();
  const principal = { id: 'user:owner', kind: 'user' as const };
  const runtime = createInMemoryRuntime({
    memberships: [
      { projectId: 'project:one', principalId: principal.id, role: 'owner' },
      { projectId: 'project:two', principalId: principal.id, role: 'viewer' },
    ],
    mediaExecutor,
    publisherAdapters: [youtube],
    workerId: 'worker:smoke',
  });

  await runtime.assets.create({
    id: 'asset:source',
    projectId: 'project:one',
    kind: 'source-video',
    objectKey: 'projects/project-one/assets/source/source.mp4',
    contentType: 'video/mp4',
    bytes: 1024,
    createdAt: '2026-09-16T00:00:00.000Z',
  });

  const lifecycle: string[] = [];
  const unsubscribers = [
    runtime.events.subscribe('job.execution.started', (event) => lifecycle.push(event.type)),
    runtime.events.subscribe('job.execution.completed', (event) => lifecycle.push(event.type)),
    runtime.events.subscribe('job.execution.failed', (event) => lifecycle.push(event.type)),
  ];

  try {
    const media = await runtime.api.createMediaJob({
      principal,
      projectId: 'project:one',
      jobId: 'media:project-one:1',
      assetId: 'asset:source',
      transform: {
        operations: [{ type: 'trim', startMs: 0, endMs: 5_000 }],
        output: { container: 'mp4', videoCodec: 'h264' },
      },
    });

    assert.equal((await runtime.api.getJobStatus(principal, 'project:one', media.jobId))?.status, 'ready');
    assert.equal(await runtime.api.getJobStatus(principal, 'project:two', media.jobId), null);

    const mediaRun = await runtime.runMediaOnce();
    assert.equal(mediaRun.kind, 'completed');
    assert.equal((await runtime.api.getJobStatus(principal, 'project:one', media.jobId))?.status, 'completed');
    assert.equal(mediaExecutor.plans.length, 1);
    assert.equal(mediaExecutor.plans[0]?.sourceAssetId, 'asset:source');
    assert.deepEqual(mediaExecutor.plans[0]?.operations, [{ type: 'trim', startMs: 0, endMs: 5_000 }]);

    const publish = await runtime.api.createPublish({
      principal,
      request: {
        idempotencyKey: 'publish-one',
        projectId: 'project:one',
        targets: [{ network: 'youtube', accountId: 'account:youtube' }],
        assets: [{ assetId: 'asset:source', uri: 'memory://source.mp4', mimeType: 'video/mp4' }],
        caption: 'VideoOS smoke publish',
      },
    });

    assert.equal((await runtime.api.getJobStatus(principal, 'project:one', publish.jobId))?.status, 'ready');
    const publishRun = await runtime.runPublishOnce();
    assert.equal(publishRun.kind, 'completed');
    assert.equal((await runtime.api.getJobStatus(principal, 'project:one', publish.jobId))?.status, 'completed');
    assert.equal(youtube.requests.length, 1);
    assert.equal(youtube.requests[0]?.targets[0]?.network, 'youtube');

    assert.deepEqual(lifecycle, [
      'job.execution.started',
      'job.execution.completed',
      'job.execution.started',
      'job.execution.completed',
    ]);
  } finally {
    for (const unsubscribe of unsubscribers) unsubscribe();
  }
});
