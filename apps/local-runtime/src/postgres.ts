import type { PublishReceipt } from '@videoos/contracts';

import {
  createPostgresPool,
  PostgresAssetRepository,
  PostgresEventOutbox,
  PostgresJobQueue,
  PostgresJsonStore,
  PostgresMembershipRepository,
  PostgresOutboxEventBus,
} from '../../../packages/adapters/persistence-postgres/src/index.js';
import type { MediaExecutor } from '../../../services/media-worker/src/index.js';
import type { NetworkPublisherAdapter } from '../../../services/publisher/src/index.js';
import { createRuntime } from './index.js';

export interface PostgresRuntimeOptions {
  connectionString: string;
  mediaExecutor: MediaExecutor;
  publisherAdapters: NetworkPublisherAdapter[];
  workerId?: string;
}

export function createPostgresRuntime(options: PostgresRuntimeOptions) {
  const pool = createPostgresPool(options.connectionString);
  const outbox = new PostgresEventOutbox(pool);
  const events = new PostgresOutboxEventBus(outbox);
  const ports = {
    memberships: new PostgresMembershipRepository(pool),
    assets: new PostgresAssetRepository(pool),
    jobs: new PostgresJobQueue(pool),
    events,
  };

  const runtime = createRuntime(ports, {
    mediaExecutor: options.mediaExecutor,
    publisherAdapters: options.publisherAdapters,
    publisherIdempotency: new PostgresJsonStore<PublishReceipt[]>(pool, 'publisher-idempotency'),
    workerId: options.workerId ?? 'postgres-runtime',
  });

  return {
    ...runtime,
    pool,
    outbox,
    async close() {
      await pool.end();
    },
  };
}
