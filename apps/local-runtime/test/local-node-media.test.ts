import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryNodeTaskBroker, type NodeTaskResult } from '../../../packages/node-protocol/src/index.js';
import type { MediaExecutionPlan, MediaExecutor } from '../../../services/media-worker/src/index.js';
import { createInMemoryRuntime } from '../src/index.js';
import {
  LocalMediaNodeAgent,
  LocalNodeExecutionError,
  LocalNodeMediaExecutor,
  type NodeTaskTransport,
} from '../src/local-node-media-executor.js';
import type { MediaArtifactFinalizer, MediaArtifactFinalizeInput } from '../src/media-artifact.js';

function mediaPlan(): MediaExecutionPlan {
  return {
    sourceAssetId: 'asset:source',
    preset: { id: 'vertical-short', version: 1 },
    operations: [{ type: 'resize', width: 1080, height: 1920, fit: 'cover' }],
    output: { container: 'mp4', videoCodec: 'h264', audioCodec: 'aac' },
    context: {
      projectId: 'project:one',
      jobId: 'media:project-one:1',
      sourceObjectKey: 'projects/project:one/assets/asset:source/source.mp4',
    },
  };
}

function registerNode(
  broker: InMemoryNodeTaskBroker,
  nodeId: string,
  resources?: { memoryBytes?: number; accelerators?: Array<{ kind: 'gpu'; name?: string }> },
) {
  broker.register({
    nodeId,
    projectId: 'project:one',
    name: nodeId,
    capabilities: ['media.ffmpeg'],
    platform: 'linux',
    version: '1.0.0',
    ...(resources ? { resources } : {}),
    registeredAt: '2026-09-16T00:00:00.000Z',
  });
}

test('local-node media executor selects a GPU-capable node and preserves transform context', async () => {
  const broker = new InMemoryNodeTaskBroker(() => new Date('2026-09-16T00:00:00.000Z'));
  registerNode(broker, 'node:cpu', { memoryBytes: 16_000 });
  registerNode(broker, 'node:gpu', { memoryBytes: 32_000, accelerators: [{ kind: 'gpu', name: 'test-gpu' }] });

  let seenNodeId = '';
  let seenSourceKey = '';
  let seenPreset: unknown;
  const transport: NodeTaskTransport = {
    async execute(lease) {
      seenNodeId = lease.nodeId;
      if (lease.payload.kind !== 'media-transform') throw new Error('unexpected task kind');
      seenSourceKey = lease.payload.sourceObjectKey;
      seenPreset = lease.payload.request.preset;
      return {
        leaseId: lease.leaseId,
        taskId: lease.taskId,
        nodeId: lease.nodeId,
        status: 'succeeded',
        output: {
          assetId: 'asset:derived:node',
          uri: 'file:///tmp/node-output.mp4',
          executor: 'ffmpeg',
          executorVersion: '7.1',
        },
        completedAt: '2026-09-16T00:00:01.000Z',
      };
    },
  };

  const executor = new LocalNodeMediaExecutor({
    broker,
    transport,
    requirements: { accelerator: 'gpu', minMemoryBytes: 20_000 },
  });
  const result = await executor.execute(mediaPlan());

  assert.deepEqual(result, { assetId: 'asset:derived:node', uri: 'file:///tmp/node-output.mp4' });
  assert.equal(seenNodeId, 'node:gpu');
  assert.equal(seenSourceKey, 'projects/project:one/assets/asset:source/source.mp4');
  assert.deepEqual(seenPreset, { id: 'vertical-short', version: 1 });
});

test('transport disconnect abandons the node lease so the next queue attempt can redispatch', async () => {
  const broker = new InMemoryNodeTaskBroker(() => new Date('2026-09-16T00:00:00.000Z'));
  registerNode(broker, 'node:one');
  let calls = 0;
  const executor = new LocalNodeMediaExecutor({
    broker,
    transport: {
      async execute(lease) {
        calls += 1;
        if (calls === 1) throw new Error('disconnect');
        return {
          leaseId: lease.leaseId,
          taskId: lease.taskId,
          nodeId: lease.nodeId,
          status: 'succeeded',
          output: { assetId: 'asset:derived', uri: 'file:///tmp/result.mp4', executor: 'ffmpeg' },
          completedAt: '2026-09-16T00:00:01.000Z',
        };
      },
    },
  });

  await assert.rejects(executor.execute(mediaPlan()), (error: unknown) => {
    return error instanceof LocalNodeExecutionError && error.code === 'transport-failed';
  });
  assert.deepEqual(await executor.execute(mediaPlan()), { assetId: 'asset:derived', uri: 'file:///tmp/result.mp4' });
  assert.equal(calls, 2);
});

test('failed node result does not block a later queue attempt from succeeding', async () => {
  const broker = new InMemoryNodeTaskBroker(() => new Date('2026-09-16T00:00:00.000Z'));
  registerNode(broker, 'node:one');
  const leaseIds: string[] = [];
  let attempt = 0;
  const executor = new LocalNodeMediaExecutor({
    broker,
    transport: {
      async execute(lease) {
        attempt += 1;
        leaseIds.push(lease.leaseId);
        if (attempt === 1) {
          return {
            leaseId: lease.leaseId,
            taskId: lease.taskId,
            nodeId: lease.nodeId,
            status: 'failed',
            error: 'ffmpeg failed\nprovider path hidden',
            completedAt: '2026-09-16T00:00:01.000Z',
          };
        }
        return {
          leaseId: lease.leaseId,
          taskId: lease.taskId,
          nodeId: lease.nodeId,
          status: 'succeeded',
          output: { assetId: 'asset:derived', uri: 'file:///tmp/result.mp4', executor: 'ffmpeg' },
          completedAt: '2026-09-16T00:00:02.000Z',
        };
      },
    },
  });

  await assert.rejects(executor.execute(mediaPlan()), /local node media execution failed: ffmpeg failed provider path hidden/);
  assert.deepEqual(await executor.execute(mediaPlan()), { assetId: 'asset:derived', uri: 'file:///tmp/result.mp4' });
  assert.deepEqual(leaseIds, [
    'node-lease:media:project-one:1:1',
    'node-lease:media:project-one:1:2',
  ]);
});

test('node broker deduplicates identical successful results and rejects conflicting duplicates', () => {
  const broker = new InMemoryNodeTaskBroker(() => new Date('2026-09-16T00:00:00.000Z'));
  registerNode(broker, 'node:one');
  const lease = broker.lease({
    taskId: 'task:one',
    projectId: 'project:one',
    leaseMs: 60_000,
    payload: {
      kind: 'media-transform',
      request: { sourceAssetId: 'asset:source', operations: [], output: { container: 'mp4' } },
      sourceObjectKey: 'projects/project:one/assets/asset:source/source.mp4',
    },
  });
  assert.ok(lease);
  const result: NodeTaskResult = {
    leaseId: lease.leaseId,
    taskId: lease.taskId,
    nodeId: lease.nodeId,
    status: 'succeeded',
    output: { assetId: 'asset:derived', uri: 'file:///tmp/result.mp4', executor: 'ffmpeg' },
    completedAt: '2026-09-16T00:00:01.000Z',
  };
  assert.equal(broker.acceptResult(result), 'accepted');
  assert.equal(broker.acceptResult(structuredClone(result)), 'duplicate');
  assert.throws(
    () => broker.acceptResult({ ...result, output: { ...result.output, assetId: 'asset:other' } }),
    /conflicting duplicate/,
  );
});

test('expired node leases reject stale results and can be re-leased', () => {
  let now = new Date('2026-09-16T00:00:00.000Z');
  const broker = new InMemoryNodeTaskBroker(() => now);
  registerNode(broker, 'node:one');
  const request = {
    taskId: 'task:expiry',
    projectId: 'project:one',
    leaseMs: 1_000,
    payload: {
      kind: 'media-transform' as const,
      request: { sourceAssetId: 'asset:source', operations: [], output: { container: 'mp4' } },
      sourceObjectKey: 'projects/project:one/assets/asset:source/source.mp4',
    },
  };
  const first = broker.lease(request);
  assert.ok(first);
  now = new Date('2026-09-16T00:00:02.000Z');
  assert.throws(
    () => broker.acceptResult({
      leaseId: first.leaseId,
      taskId: first.taskId,
      nodeId: first.nodeId,
      status: 'succeeded',
      output: { assetId: 'asset:x', uri: 'file:///tmp/x.mp4', executor: 'ffmpeg' },
      completedAt: now.toISOString(),
    }),
    /expired|active lease/,
  );
  const second = broker.lease(request);
  assert.ok(second);
  assert.equal(second.leaseId, 'node-lease:task:expiry:2');
});

test('local media node agent validates leases and reconstructs the provider-neutral media plan', async () => {
  let seen: MediaExecutionPlan | undefined;
  const underlying: MediaExecutor = {
    async execute(plan) {
      seen = structuredClone(plan);
      return { assetId: 'asset:derived:agent', uri: 'file:///tmp/agent.mp4' };
    },
  };
  const agent = new LocalMediaNodeAgent({
    nodeId: 'node:agent',
    executor: underlying,
    executorName: 'ffmpeg',
    executorVersion: '7.1',
    now: () => new Date('2026-09-16T00:00:00.500Z'),
  });
  const result = await agent.execute({
    leaseId: 'lease:one',
    taskId: 'job:one',
    nodeId: 'node:agent',
    projectId: 'project:one',
    payload: {
      kind: 'media-transform',
      request: {
        sourceAssetId: 'asset:source',
        preset: { id: 'vertical-short', version: 1 },
        operations: [{ type: 'resize', width: 1080, height: 1920, fit: 'cover' }],
        output: { container: 'mp4' },
      },
      sourceObjectKey: 'projects/project:one/assets/asset:source/source.mp4',
    },
    leasedAt: '2026-09-16T00:00:00.000Z',
    expiresAt: '2026-09-16T00:01:00.000Z',
  });
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.output, {
    assetId: 'asset:derived:agent',
    uri: 'file:///tmp/agent.mp4',
    executor: 'ffmpeg',
    executorVersion: '7.1',
  });
  assert.equal(seen?.context?.jobId, 'job:one');
  assert.equal(seen?.context?.sourceObjectKey, 'projects/project:one/assets/asset:source/source.mp4');
  assert.deepEqual(seen?.preset, { id: 'vertical-short', version: 1 });
});

test('queue-backed runtime uses the same artifact finalizer after local-node execution', async () => {
  const broker = new InMemoryNodeTaskBroker(() => new Date('2026-09-16T00:00:00.000Z'));
  registerNode(broker, 'node:one');
  const nodeExecutor: MediaExecutor = {
    async execute() {
      return { assetId: 'asset:derived:node', uri: 'file:///tmp/node-output.mp4' };
    },
  };
  const executor = new LocalNodeMediaExecutor({
    broker,
    transport: new LocalMediaNodeAgent({
      nodeId: 'node:one',
      executor: nodeExecutor,
      executorName: 'ffmpeg',
      now: () => new Date('2026-09-16T00:00:00.500Z'),
    }),
  });
  const finalized: MediaArtifactFinalizeInput[] = [];
  const finalizer: MediaArtifactFinalizer = {
    async finalize(input) {
      finalized.push(structuredClone(input));
      return {
        id: input.result.assetId,
        projectId: input.projectId,
        kind: 'derived-video',
        objectKey: 'projects/project:one/assets/derived/output.mp4',
        contentType: 'video/mp4',
        bytes: 1,
        createdAt: '2026-09-16T00:00:01.000Z',
      };
    },
  };
  const principal = { id: 'user:owner', kind: 'user' as const };
  const runtime = createInMemoryRuntime({
    memberships: [{ projectId: 'project:one', principalId: principal.id, role: 'owner' }],
    mediaExecutor: executor,
    mediaArtifactFinalizer: finalizer,
    mediaExecutorName: 'local-node',
    publisherAdapters: [],
  });
  await runtime.assets.create({
    id: 'asset:source',
    projectId: 'project:one',
    kind: 'source-video',
    objectKey: 'projects/project:one/assets/asset:source/source.mp4',
    contentType: 'video/mp4',
    bytes: 10,
    createdAt: '2026-09-16T00:00:00.000Z',
  });
  await runtime.api.createMediaJob({
    principal,
    projectId: 'project:one',
    jobId: 'media:project-one:runtime',
    assetId: 'asset:source',
    transform: { operations: [], output: { container: 'mp4' } },
  });

  const run = await runtime.runMediaOnce();
  assert.equal(run.kind, 'completed');
  assert.equal(finalized.length, 1);
  assert.equal(finalized[0]?.result.assetId, 'asset:derived:node');
  assert.equal(finalized[0]?.executor, 'local-node');
});
