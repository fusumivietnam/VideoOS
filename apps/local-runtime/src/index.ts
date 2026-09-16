import type { PublishRequest } from '@videoos/contracts';
import { InMemoryEventBus } from '@videoos/event-fabric';
import { InMemoryMembershipRepository, type ProjectMembership } from '@videoos/identity';
import { InMemoryJobQueue } from '@videoos/job-queue';
import { InMemoryAssetRepository } from '@videoos/storage';

import { VideoOsApi, type MediaJobPayload } from '../../../services/api/src/index.js';
import { MediaWorker, type MediaExecutor } from '../../../services/media-worker/src/index.js';
import { QueueRunner } from '../../../services/orchestrator/src/index.js';
import {
  InMemoryIdempotencyStore,
  PublisherService,
  type NetworkPublisherAdapter,
} from '../../../services/publisher/src/index.js';

export interface InMemoryRuntimeOptions {
  memberships?: ProjectMembership[];
  mediaExecutor: MediaExecutor;
  publisherAdapters: NetworkPublisherAdapter[];
  workerId?: string;
}

export function createInMemoryRuntime(options: InMemoryRuntimeOptions) {
  const memberships = new InMemoryMembershipRepository(options.memberships ?? []);
  const assets = new InMemoryAssetRepository();
  const jobs = new InMemoryJobQueue();
  const events = new InMemoryEventBus();
  const api = new VideoOsApi({ memberships, assets, jobs });
  const mediaWorker = new MediaWorker(options.mediaExecutor);
  const publisher = new PublisherService(options.publisherAdapters, new InMemoryIdempotencyStore());
  const runner = new QueueRunner(jobs, events, { workerId: options.workerId ?? 'local-runtime' });

  return {
    api,
    memberships,
    assets,
    jobs,
    events,
    async runMediaOnce() {
      return runner.runOnce<MediaJobPayload>('media', async (job) => {
        const payload = job.payload;
        const source = await assets.getById(payload.assetId);
        if (!source || source.projectId !== payload.projectId) {
          throw new Error('media source asset not found in project');
        }

        await mediaWorker.transform({
          sourceAssetId: payload.assetId,
          operations: payload.transform.operations,
          output: payload.transform.output,
        });
      });
    },
    async runPublishOnce() {
      return runner.runOnce<PublishRequest>('publish', async (job) => {
        await publisher.publish(job.payload);
      });
    },
  };
}
