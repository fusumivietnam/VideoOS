import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { PublishRequest } from '@videoos/contracts';
import type { MediaExecutionPlan } from '../../../services/media-worker/src/index.js';
import { FileSystemObjectStore } from '../src/filesystem-object-store.js';
import { createInMemoryRuntime } from '../src/index.js';

class FakeMediaExecutor {
  readonly plans: MediaExecutionPlan[] = [];

  async execute(plan: MediaExecutionPlan) {
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
    runtime.events.subscribe('job.execution.started', (event) => {
      lifecycle.push(event.type);
    }),
    runtime.events.subscribe('job.execution.completed', (event) => {
      lifecycle.push(event.type);
    }),
    runtime.events.subscribe('job.execution.failed', (event) => {
      lifecycle.push(event.type);
    }),
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
    assert.deepEqual(mediaExecutor.plans[0]?.context, {
      projectId: 'project:one',
      jobId: 'media:project-one:1',
      sourceObjectKey: 'projects/project-one/assets/source/source.mp4',
    });

    const publish = await runtime.api.createPublish({
      principal,
      approval: {
        approvedBy: principal,
        approvedAt: '2026-09-17T00:30:00.000Z',
      },
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

async function withFileSystemStore(
  run: (store: FileSystemObjectStore, root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'videoos-object-store-'));
  try {
    await run(new FileSystemObjectStore(root), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('filesystem object store round-trips project-scoped nested objects and deletes idempotently', async () => {
  await withFileSystemStore(async (store, root) => {
    const body = new TextEncoder().encode('hello VideoOS');
    const checksumSha256 = createHash('sha256').update(body).digest('hex');
    const key = 'projects/project-1/assets/asset-1/source.txt';

    await store.put({ key, contentType: 'text/plain', body, checksumSha256 });
    assert.deepEqual(await store.get(key), body);
    assert.equal((await readFile(join(root, key))).toString('utf8'), 'hello VideoOS');

    await store.delete(key);
    assert.equal(await store.get(key), null);
    await store.delete(key);
  });
});

test('filesystem object store rejects traversal and ambiguous object keys', async () => {
  await withFileSystemStore(async (store) => {
    const body = new Uint8Array([1]);
    const unsafeKeys = [
      '../escape.bin',
      '/absolute.bin',
      'projects//asset.bin',
      'projects/./asset.bin',
      'projects/../asset.bin',
      'projects\\asset.bin',
    ];

    for (const key of unsafeKeys) {
      await assert.rejects(
        store.put({ key, contentType: 'application/octet-stream', body }),
        /object key|absolute object keys/,
      );
    }
  });
});

test('filesystem object store rejects checksum mismatch before committing an object', async () => {
  await withFileSystemStore(async (store) => {
    const key = 'projects/project-1/assets/asset-2/output.bin';
    await assert.rejects(
      store.put({
        key,
        contentType: 'application/octet-stream',
        body: new Uint8Array([1, 2, 3]),
        checksumSha256: '0'.repeat(64),
      }),
      /checksum mismatch/,
    );
    assert.equal(await store.get(key), null);
  });
});

test('filesystem object store does not expose local paths as signed URLs', async () => {
  await withFileSystemStore(async (store) => {
    await assert.rejects(
      store.signedReadUrl('projects/project-1/assets/asset-1/source.txt', 60),
      /signed read URLs are not supported/,
    );
  });
});
