import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  PostgresAssetRepository,
  PostgresEventOutbox,
  PostgresJobQueue,
  PostgresMembershipRepository,
  withTransaction,
} from '../src/index.ts';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const pool = new Pool({ connectionString });
const suffix = randomUUID();
const projectId = `project:${suffix}`;
const principalId = `user:${suffix}`;
const assetId = `asset:${suffix}`;
const rolledBackAssetId = `asset:rollback:${suffix}`;
const jobId = `job:${suffix}`;
const outboxId = `outbox:${suffix}`;
const rolledBackOutboxId = `outbox:rollback:${suffix}`;

try {
  await pool.query('INSERT INTO projects (id, name) VALUES ($1, $2)', [projectId, 'Integration Project']);
  await pool.query(
    'INSERT INTO project_memberships (project_id, principal_id, role) VALUES ($1, $2, $3)',
    [projectId, principalId, 'owner'],
  );

  const memberships = new PostgresMembershipRepository(pool);
  const membership = await memberships.get(projectId, principalId);
  assert.deepEqual(membership, { projectId, principalId, role: 'owner' });

  const assets = new PostgresAssetRepository(pool);
  await assets.create({
    id: assetId,
    projectId,
    kind: 'source-video',
    objectKey: `projects/${projectId}/assets/${assetId}/source.mp4`,
    contentType: 'video/mp4',
    bytes: 1234,
    checksumSha256: 'a'.repeat(64),
    createdAt: new Date().toISOString(),
    metadata: { width: 1920, height: 1080 },
  });
  assert.equal((await assets.getById(assetId))?.bytes, 1234);
  assert.equal((await assets.listByProject(projectId)).length, 1);

  const queue = new PostgresJobQueue(pool);
  await queue.enqueue('media', jobId, { projectId, assetId }, { maxAttempts: 3 });
  const leased = await queue.lease<{ projectId: string; assetId: string }>('media', 'worker:test', 30_000);
  assert.equal(leased?.id, jobId);
  assert.equal(leased?.status, 'leased');
  assert.equal(leased?.attempts, 1);
  assert.equal(leased?.payload.projectId, projectId);
  await queue.complete(jobId);

  const outbox = new PostgresEventOutbox(pool);
  await outbox.append({
    id: outboxId,
    event: {
      id: `event:${suffix}`,
      type: 'asset.created',
      version: 1,
      projectId,
      occurredAt: new Date().toISOString(),
      payload: { assetId },
    },
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
  const pending = await outbox.pending(10);
  assert.ok(pending.some((record) => record.id === outboxId));
  await outbox.markDelivered(outboxId, new Date().toISOString());
  assert.ok(!(await outbox.pending(10)).some((record) => record.id === outboxId));

  await assert.rejects(
    withTransaction(pool, async (client) => {
      const txAssets = new PostgresAssetRepository(client);
      const txOutbox = new PostgresEventOutbox(client);
      await txAssets.create({
        id: rolledBackAssetId,
        projectId,
        kind: 'derived-video',
        objectKey: `projects/${projectId}/assets/${rolledBackAssetId}/output.mp4`,
        contentType: 'video/mp4',
        bytes: 1,
        createdAt: new Date().toISOString(),
      });
      await txOutbox.append({
        id: rolledBackOutboxId,
        event: {
          id: `event:rollback:${suffix}`,
          type: 'asset.created',
          version: 1,
          projectId,
          occurredAt: new Date().toISOString(),
          payload: { assetId: rolledBackAssetId },
        },
        createdAt: new Date().toISOString(),
        attempts: 0,
      });
      throw new Error('force rollback');
    }),
    /force rollback/,
  );
  assert.equal(await assets.getById(rolledBackAssetId), null);
  const rollbackOutbox = await pool.query('SELECT 1 FROM outbox_events WHERE id = $1', [rolledBackOutboxId]);
  assert.equal(rollbackOutbox.rowCount, 0);

  console.log('PostgreSQL durable-core integration test passed');
} finally {
  await pool.query('DELETE FROM queue_jobs WHERE id = $1', [jobId]).catch(() => undefined);
  await pool.query('DELETE FROM outbox_events WHERE id IN ($1, $2)', [outboxId, rolledBackOutboxId]).catch(() => undefined);
  await pool.query('DELETE FROM projects WHERE id = $1', [projectId]).catch(() => undefined);
  await pool.end();
}
