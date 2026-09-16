import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  PostgresAssetRepository,
  PostgresEventOutbox,
  PostgresJobQueue,
  PostgresMembershipRepository,
  PostgresQueueSettlement,
  withTransaction,
} from '../src/index.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const pool = new Pool({ connectionString });
const suffix = randomUUID();
const projectId = `project:${suffix}`;
const principalId = `user:${suffix}`;
const assetId = `asset:${suffix}`;
const rollbackAssetId = `asset:rollback:${suffix}`;
const jobId = `job:${suffix}`;
const atomicJobId = `job:atomic:${suffix}`;
const atomicRollbackJobId = `job:atomic-rollback:${suffix}`;
const exhaustedJobId = `job:exhausted:${suffix}`;
const outboxId = `outbox:${suffix}`;
const atomicEventId = `event:atomic:${suffix}`;
const atomicRollbackEventId = `event:atomic-rollback:${suffix}`;
const rollbackOutboxId = `outbox:rollback:${suffix}`;

try {
  await pool.query('INSERT INTO projects (id, name) VALUES ($1, $2)', [projectId, 'Integration Project']);
  await pool.query(
    'INSERT INTO project_memberships (project_id, principal_id, role) VALUES ($1, $2, $3)',
    [projectId, principalId, 'owner'],
  );

  const memberships = new PostgresMembershipRepository(pool);
  assert.deepEqual(await memberships.get(projectId, principalId), { projectId, principalId, role: 'owner' });

  const assets = new PostgresAssetRepository(pool);
  await assets.create({
    id: assetId,
    projectId,
    kind: 'source-video',
    objectKey: `projects/${projectId}/assets/${assetId}/source.mp4`,
    contentType: 'video/mp4',
    bytes: 1234,
    checksumSha256: 'a'.repeat(64),
    metadata: { width: 1920, height: 1080 },
    createdAt: new Date().toISOString(),
  });
  assert.equal((await assets.getById(assetId))?.bytes, 1234);
  assert.equal((await assets.listByProject(projectId)).length, 1);

  const queue = new PostgresJobQueue(pool);
  const leaseTime = new Date();
  await queue.enqueue('media', jobId, { projectId, assetId }, { maxAttempts: 3, availableAt: leaseTime.toISOString() });
  const leased = await queue.lease<{ projectId: string; assetId: string }>('media', 'worker:test', 30_000, leaseTime);
  assert.equal(leased?.id, jobId);
  assert.equal(leased?.attempts, 1);
  assert.equal(leased?.payload.projectId, projectId);
  assert.equal((await queue.get(jobId))?.status, 'leased');
  await queue.complete(jobId);
  assert.equal((await queue.get(jobId))?.status, 'completed');

  await queue.enqueue('media', exhaustedJobId, { projectId, assetId }, { maxAttempts: 1, availableAt: leaseTime.toISOString() });
  const finalLease = await queue.lease('media', 'worker:stalled', 1_000, leaseTime);
  assert.equal(finalLease?.id, exhaustedJobId);
  assert.equal(finalLease?.attempts, 1);
  const afterExpiry = new Date(leaseTime.getTime() + 1_001);
  assert.equal(await queue.lease('media', 'worker:recovery', 1_000, afterExpiry), null);
  const exhausted = await queue.get(exhaustedJobId);
  assert.equal(exhausted?.status, 'dead-letter');
  assert.equal(exhausted?.attempts, 1);
  assert.equal(exhausted?.lastError, 'lease expired after maximum attempts');

  const outbox = new PostgresEventOutbox(pool);
  await outbox.append({
    id: outboxId,
    event: {
      id: `event:${suffix}`,
      type: 'asset.created',
      version: 1,
      occurredAt: new Date().toISOString(),
      correlationId: projectId,
      payload: { projectId, assetId },
    },
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
  assert.ok((await outbox.pending(10)).some((record) => record.id === outboxId));
  await outbox.markDelivered(outboxId, new Date().toISOString());
  assert.ok(!(await outbox.pending(10)).some((record) => record.id === outboxId));

  const settlement = new PostgresQueueSettlement(pool);
  await queue.enqueue('media', atomicJobId, { projectId, assetId }, { maxAttempts: 3, availableAt: leaseTime.toISOString() });
  assert.equal((await queue.lease('media', 'worker:atomic', 30_000, leaseTime))?.id, atomicJobId);
  await settlement.complete(atomicJobId, {
    id: atomicEventId,
    type: 'job.execution.completed',
    version: 1,
    occurredAt: new Date().toISOString(),
    correlationId: atomicJobId,
    payload: { jobId: atomicJobId, status: 'completed' },
  });
  assert.equal((await queue.get(atomicJobId))?.status, 'completed');
  assert.ok((await outbox.pending(20)).some((record) => record.id === atomicEventId));

  await queue.enqueue('media', atomicRollbackJobId, { projectId, assetId }, { maxAttempts: 3, availableAt: leaseTime.toISOString() });
  assert.equal((await queue.lease('media', 'worker:atomic-rollback', 30_000, leaseTime))?.id, atomicRollbackJobId);
  await outbox.append({
    id: atomicRollbackEventId,
    event: {
      id: atomicRollbackEventId,
      type: 'test.conflict',
      version: 1,
      occurredAt: new Date().toISOString(),
      correlationId: atomicRollbackJobId,
      payload: {},
    },
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
  await assert.rejects(
    settlement.complete(atomicRollbackJobId, {
      id: atomicRollbackEventId,
      type: 'job.execution.completed',
      version: 1,
      occurredAt: new Date().toISOString(),
      correlationId: atomicRollbackJobId,
      payload: { jobId: atomicRollbackJobId, status: 'completed' },
    }),
  );
  assert.equal((await queue.get(atomicRollbackJobId))?.status, 'leased');

  await assert.rejects(
    withTransaction(pool, async (client) => {
      await new PostgresAssetRepository(client).create({
        id: rollbackAssetId,
        projectId,
        kind: 'derived-video',
        objectKey: `projects/${projectId}/assets/${rollbackAssetId}/output.mp4`,
        contentType: 'video/mp4',
        bytes: 1,
        createdAt: new Date().toISOString(),
      });
      await new PostgresEventOutbox(client).append({
        id: rollbackOutboxId,
        event: {
          id: `event:rollback:${suffix}`,
          type: 'asset.created',
          version: 1,
          occurredAt: new Date().toISOString(),
          correlationId: projectId,
          payload: { projectId, assetId: rollbackAssetId },
        },
        createdAt: new Date().toISOString(),
        attempts: 0,
      });
      throw new Error('force rollback');
    }),
    /force rollback/,
  );
  assert.equal(await assets.getById(rollbackAssetId), null);
  assert.equal((await pool.query('SELECT 1 FROM outbox_events WHERE id = $1', [rollbackOutboxId])).rowCount, 0);

  console.log('PostgreSQL durable-core integration test passed');
} finally {
  await pool.query(
    'DELETE FROM queue_jobs WHERE id IN ($1, $2, $3, $4)',
    [jobId, exhaustedJobId, atomicJobId, atomicRollbackJobId],
  ).catch(() => undefined);
  await pool.query(
    'DELETE FROM outbox_events WHERE id IN ($1, $2, $3, $4)',
    [outboxId, rollbackOutboxId, atomicEventId, atomicRollbackEventId],
  ).catch(() => undefined);
  await pool.query('DELETE FROM projects WHERE id = $1', [projectId]).catch(() => undefined);
  await pool.end();
}
