import type { EventBusPort, PublishRequest } from '@videoos/contracts';
import { InMemoryEventBus } from '@videoos/event-fabric';
import {
  InMemoryMembershipRepository,
  type MembershipRepository,
  type ProjectMembership,
} from '@videoos/identity';
import { InMemoryJobQueue, type JobQueue } from '@videoos/job-queue';
import { InMemoryAssetRepository, type AssetRepository } from '@videoos/storage';

import { VideoOsApi, type MediaJobPayload } from '../../../services/api/src/index.js';
import { MediaWorker, type MediaExecutor } from '../../../services/media-worker/src/index.js';
import { QueueRunner, type QueueSettlementPort } from '../../../services/orchestrator/src/index.js';
import {
  type IdempotencyStore,
  InMemoryIdempotencyStore,
  PublisherService,
  type NetworkPublisherAdapter,
} from '../../../services/publisher/src/index.js';
import type { MediaArtifactFinalizer } from './media-artifact.js';

export interface RuntimePorts {
  memberships: MembershipRepository;
  assets: AssetRepository;
  jobs: JobQueue;
  events: EventBusPort;
}

export interface RuntimeExecutionOptions {
  mediaExecutor: MediaExecutor;
  mediaArtifactFinalizer?: MediaArtifactFinalizer;
  mediaExecutorName?: string;
  mediaExecutorVersion?: string;
  publisherAdapters: NetworkPublisherAdapter[];
  publisherIdempotency: IdempotencyStore;
  queueSettlement?: QueueSettlementPort;
  workerId?: string;
}

export function createRuntime<TPorts extends RuntimePorts>(
  ports: TPorts,
  options: RuntimeExecutionOptions,
) {
  const api = new VideoOsApi({
    memberships: ports.memberships,
    assets: ports.assets,
    jobs: ports.jobs,
  });
  const mediaWorker = new MediaWorker(options.mediaExecutor);
  const publisher = new PublisherService(options.publisherAdapters, options.publisherIdempotency);
  const runner = new QueueRunner(ports.jobs, ports.events, {
    workerId: options.workerId ?? 'videoos-runtime',
    ...(options.queueSettlement ? { settlement: options.queueSettlement } : {}),
  });

  return {
    api,
    ...ports,
    async runMediaOnce() {
      return runner.runOnce<MediaJobPayload>('media', async (job) => {
        const payload = job.payload;
        const source = await ports.assets.getById(payload.assetId);
        if (!source || source.projectId !== payload.projectId) {
          throw new Error('media source asset not found in project');
        }

        const result = await mediaWorker.transform(
          {
            sourceAssetId: payload.assetId,
            ...(payload.transform.preset ? { preset: payload.transform.preset } : {}),
            operations: payload.transform.operations,
            output: payload.transform.output,
          },
          {
            projectId: payload.projectId,
            jobId: job.id,
            sourceObjectKey: source.objectKey,
          },
        );

        if (options.mediaArtifactFinalizer) {
          await options.mediaArtifactFinalizer.finalize({
            projectId: payload.projectId,
            jobId: job.id,
            sourceAssetId: payload.assetId,
            transform: payload.transform,
            result,
            executor: options.mediaExecutorName ?? 'media-executor',
            ...(options.mediaExecutorVersion ? { executorVersion: options.mediaExecutorVersion } : {}),
          });
        }
      });
    },
    async runPublishOnce() {
      return runner.runOnce<PublishRequest>('publish', async (job) => {
        await publisher.publish(job.payload);
      });
    },
  };
}

export interface InMemoryRuntimeOptions {
  memberships?: ProjectMembership[];
  mediaExecutor: MediaExecutor;
  mediaArtifactFinalizer?: MediaArtifactFinalizer;
  mediaExecutorName?: string;
  mediaExecutorVersion?: string;
  publisherAdapters: NetworkPublisherAdapter[];
  workerId?: string;
}

export function createInMemoryRuntime(options: InMemoryRuntimeOptions) {
  const ports = {
    memberships: new InMemoryMembershipRepository(options.memberships ?? []),
    assets: new InMemoryAssetRepository(),
    jobs: new InMemoryJobQueue(),
    events: new InMemoryEventBus(),
  };

  return createRuntime(ports, {
    mediaExecutor: options.mediaExecutor,
    ...(options.mediaArtifactFinalizer ? { mediaArtifactFinalizer: options.mediaArtifactFinalizer } : {}),
    ...(options.mediaExecutorName ? { mediaExecutorName: options.mediaExecutorName } : {}),
    ...(options.mediaExecutorVersion ? { mediaExecutorVersion: options.mediaExecutorVersion } : {}),
    publisherAdapters: options.publisherAdapters,
    publisherIdempotency: new InMemoryIdempotencyStore(),
    workerId: options.workerId ?? 'local-runtime',
  });
}
