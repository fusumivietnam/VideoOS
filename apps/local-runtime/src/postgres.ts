import type { PublishReceipt } from '@videoos/contracts';
import type { ObjectStore } from '@videoos/storage';

import {
  checkPostgresReadiness,
  createPostgresPool,
  PostgresAssetRepository,
  PostgresEventOutbox,
  PostgresJobQueue,
  PostgresJsonStore,
  PostgresMembershipRepository,
  PostgresOutboxEventBus,
  PostgresQueueSettlement,
} from '../../../packages/adapters/persistence-postgres/src/index.js';
import type { MediaExecutor } from '../../../services/media-worker/src/index.js';
import type { NetworkPublisherAdapter } from '../../../services/publisher/src/index.js';
import { createRuntime } from './index.js';
import { DerivedAssetFinalizer, FfprobeMediaProbe, type MediaProbe } from './media-artifact.js';

export interface PostgresRuntimeOptions {
  connectionString: string;
  mediaExecutor: MediaExecutor;
  objectStore?: ObjectStore;
  mediaProbe?: MediaProbe;
  mediaExecutorName?: string;
  mediaExecutorVersion?: string;
  publisherAdapters: NetworkPublisherAdapter[];
  workerId?: string;
}

export function createPostgresRuntime(options: PostgresRuntimeOptions) {
  const pool = createPostgresPool(options.connectionString);
  const outbox = new PostgresEventOutbox(pool);
  const events = new PostgresOutboxEventBus(outbox);
  const assets = new PostgresAssetRepository(pool);
  const ports = {
    memberships: new PostgresMembershipRepository(pool),
    assets,
    jobs: new PostgresJobQueue(pool),
    events,
  };
  const mediaArtifactFinalizer = options.objectStore
    ? new DerivedAssetFinalizer({
        objects: options.objectStore,
        assets,
        probe: options.mediaProbe ?? new FfprobeMediaProbe(),
      })
    : undefined;

  const runtime = createRuntime(ports, {
    mediaExecutor: options.mediaExecutor,
    ...(mediaArtifactFinalizer ? { mediaArtifactFinalizer } : {}),
    ...(options.mediaExecutorName ? { mediaExecutorName: options.mediaExecutorName } : {}),
    ...(options.mediaExecutorVersion ? { mediaExecutorVersion: options.mediaExecutorVersion } : {}),
    publisherAdapters: options.publisherAdapters,
    publisherIdempotency: new PostgresJsonStore<PublishReceipt[]>(pool, 'publisher-idempotency'),
    queueSettlement: new PostgresQueueSettlement(pool),
    workerId: options.workerId ?? 'postgres-runtime',
  });

  return {
    ...runtime,
    pool,
    outbox,
    liveness() {
      return { status: 'alive' as const };
    },
    async readiness() {
      return checkPostgresReadiness(pool);
    },
    async close() {
      await pool.end();
    },
  };
}
