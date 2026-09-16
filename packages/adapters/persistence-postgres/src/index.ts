import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import type { EventOutbox, EventOutboxRecord } from '@videoos/event-fabric';
import type { MembershipRepository, ProjectMembership } from '@videoos/identity';
import type { EnqueueOptions, JobQueue, QueueJob } from '@videoos/job-queue';
import type { AssetRecord, AssetRepository } from '@videoos/storage';

export type Queryable = Pick<PoolClient, 'query'>;

export function createPostgresPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export class PostgresMembershipRepository implements MembershipRepository {
  constructor(private readonly db: Queryable) {}

  async get(projectId: string, principalId: string): Promise<ProjectMembership | null> {
    const result = await this.db.query<{ project_id: string; principal_id: string; role: ProjectMembership['role'] }>(
      'SELECT project_id, principal_id, role FROM project_memberships WHERE project_id = $1 AND principal_id = $2',
      [projectId, principalId],
    );
    const row = result.rows[0];
    return row ? { projectId: row.project_id, principalId: row.principal_id, role: row.role } : null;
  }
}

export class PostgresAssetRepository implements AssetRepository {
  constructor(private readonly db: Queryable) {}

  async create(asset: AssetRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO assets (id, project_id, kind, object_key, content_type, bytes, checksum_sha256, metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
      [
        asset.id,
        asset.projectId,
        asset.kind,
        asset.objectKey,
        asset.contentType,
        asset.bytes,
        asset.checksumSha256 ?? null,
        asset.metadata ? JSON.stringify(asset.metadata) : null,
        asset.createdAt,
      ],
    );
  }

  async getById(id: string): Promise<AssetRecord | null> {
    const result = await this.db.query<AssetRow>('SELECT * FROM assets WHERE id = $1', [id]);
    const row = result.rows[0];
    return row ? mapAsset(row) : null;
  }

  async listByProject(projectId: string): Promise<AssetRecord[]> {
    const result = await this.db.query<AssetRow>(
      'SELECT * FROM assets WHERE project_id = $1 ORDER BY created_at, id',
      [projectId],
    );
    return result.rows.map(mapAsset);
  }
}

interface AssetRow extends QueryResultRow {
  id: string;
  project_id: string;
  kind: AssetRecord['kind'];
  object_key: string;
  content_type: string;
  bytes: string | number;
  checksum_sha256: string | null;
  metadata: AssetRecord['metadata'] | null;
  created_at: Date | string;
}

function mapAsset(row: AssetRow): AssetRecord {
  const asset: AssetRecord = {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    objectKey: row.object_key,
    contentType: row.content_type,
    bytes: Number(row.bytes),
    createdAt: toIso(row.created_at),
  };
  if (row.checksum_sha256 !== null) asset.checksumSha256 = row.checksum_sha256;
  if (row.metadata !== null) asset.metadata = row.metadata;
  return asset;
}

export class PostgresJobQueue implements JobQueue {
  constructor(private readonly pool: Pool) {}

  async enqueue<T>(queue: string, id: string, payload: T, options: EnqueueOptions = {}): Promise<void> {
    await this.pool.query(
      `INSERT INTO queue_jobs (id, queue, payload, status, attempts, max_attempts, available_at)
       VALUES ($1,$2,$3::jsonb,'ready',0,$4,$5)
       ON CONFLICT (id) DO NOTHING`,
      [id, queue, JSON.stringify(payload), options.maxAttempts ?? 5, options.availableAt ?? new Date().toISOString()],
    );
  }

  async lease<T>(queue: string, workerId: string, leaseMs: number, now = new Date()): Promise<QueueJob<T> | null> {
    return withTransaction(this.pool, async (client) => {
      const selected = await client.query<QueueJobRow>(
        `SELECT * FROM queue_jobs
         WHERE queue = $1
           AND available_at <= $2
           AND (status = 'ready' OR (status = 'leased' AND lease_expires_at <= $2))
         ORDER BY available_at, created_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
        [queue, now.toISOString()],
      );
      const row = selected.rows[0];
      if (!row) return null;

      const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
      const updated = await client.query<QueueJobRow>(
        `UPDATE queue_jobs
         SET status = 'leased', lease_owner = $2, lease_expires_at = $3, attempts = attempts + 1, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [row.id, workerId, leaseExpiresAt],
      );
      const updatedRow = updated.rows[0];
      if (!updatedRow) throw new Error(`queue job disappeared while leasing: ${row.id}`);
      return mapQueueJob<T>(updatedRow);
    });
  }

  async complete(id: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE queue_jobs
       SET status = 'completed', lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
       WHERE id = $1`,
      [id],
    );
    if (!result.rowCount) throw new Error(`queue job not found: ${id}`);
  }

  async fail(id: string, error: string, retryAt: string): Promise<void> {
    const result = await this.pool.query<QueueJobRow>(
      `UPDATE queue_jobs
       SET status = CASE WHEN attempts >= max_attempts THEN 'dead-letter' ELSE 'ready' END,
           available_at = CASE WHEN attempts >= max_attempts THEN available_at ELSE $3 END,
           last_error = $2,
           lease_owner = NULL,
           lease_expires_at = NULL,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, error, retryAt],
    );
    if (!result.rows[0]) throw new Error(`queue job not found: ${id}`);
  }
}

interface QueueJobRow extends QueryResultRow {
  id: string;
  queue: string;
  payload: unknown;
  status: QueueJob['status'];
  attempts: number;
  max_attempts: number;
  available_at: Date | string;
  lease_owner: string | null;
  lease_expires_at: Date | string | null;
  last_error: string | null;
}

function mapQueueJob<T>(row: QueueJobRow): QueueJob<T> {
  const job: QueueJob<T> = {
    id: row.id,
    queue: row.queue,
    payload: row.payload as T,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    availableAt: toIso(row.available_at),
  };
  if (row.lease_owner !== null) job.leaseOwner = row.lease_owner;
  if (row.lease_expires_at !== null) job.leaseExpiresAt = toIso(row.lease_expires_at);
  if (row.last_error !== null) job.lastError = row.last_error;
  return job;
}

export class PostgresEventOutbox implements EventOutbox {
  constructor(private readonly db: Queryable) {}

  async append(record: EventOutboxRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO outbox_events (id, event, created_at, delivered_at, attempts)
       VALUES ($1,$2::jsonb,$3,$4,$5)`,
      [record.id, JSON.stringify(record.event), record.createdAt, record.deliveredAt ?? null, record.attempts],
    );
  }

  async pending(limit: number): Promise<EventOutboxRecord[]> {
    const result = await this.db.query<OutboxRow>(
      `SELECT id, event, created_at, delivered_at, attempts
       FROM outbox_events
       WHERE delivered_at IS NULL
       ORDER BY created_at, id
       LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapOutbox);
  }

  async markDelivered(id: string, deliveredAt: string): Promise<void> {
    const result = await this.db.query('UPDATE outbox_events SET delivered_at = $2 WHERE id = $1', [id, deliveredAt]);
    if (!result.rowCount) throw new Error(`outbox record not found: ${id}`);
  }

  async incrementAttempts(id: string): Promise<void> {
    const result = await this.db.query('UPDATE outbox_events SET attempts = attempts + 1 WHERE id = $1', [id]);
    if (!result.rowCount) throw new Error(`outbox record not found: ${id}`);
  }
}

interface OutboxRow extends QueryResultRow {
  id: string;
  event: EventOutboxRecord['event'];
  created_at: Date | string;
  delivered_at: Date | string | null;
  attempts: number;
}

function mapOutbox(row: OutboxRow): EventOutboxRecord {
  const record: EventOutboxRecord = {
    id: row.id,
    event: row.event,
    createdAt: toIso(row.created_at),
    attempts: row.attempts,
  };
  if (row.delivered_at !== null) record.deliveredAt = toIso(row.delivered_at);
  return record;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
