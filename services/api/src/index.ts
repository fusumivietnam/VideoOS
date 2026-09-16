import type { PublishRequest } from '@videoos/contracts';
import type { JobQueue, QueueJobStatus } from '@videoos/job-queue';
import type { MembershipRepository, Principal } from '@videoos/identity';
import { authorizeProjectCapability } from '@videoos/identity';
import type { AssetRepository } from '@videoos/storage';

export interface ApiDependencies {
  memberships: MembershipRepository;
  assets: AssetRepository;
  jobs: JobQueue;
}

export interface CreatePublishCommand {
  principal: Principal;
  request: PublishRequest;
}

export interface CreateMediaJobCommand {
  principal: Principal;
  projectId: string;
  jobId: string;
  assetId: string;
  transform: Record<string, unknown>;
}

export interface JobStatusView {
  jobId: string;
  queue: string;
  status: QueueJobStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  leaseExpiresAt?: string;
}

export class VideoOsApi {
  constructor(private readonly dependencies: ApiDependencies) {}

  async listAssets(principal: Principal, projectId: string) {
    await authorizeProjectCapability(this.dependencies.memberships, principal, projectId, 'asset.read');
    return this.dependencies.assets.listByProject(projectId);
  }

  async getJobStatus(principal: Principal, projectId: string, jobId: string): Promise<JobStatusView | null> {
    await authorizeProjectCapability(this.dependencies.memberships, principal, projectId, 'project.read');

    const job = await this.dependencies.jobs.get(jobId);
    if (!job || projectIdFromPayload(job.payload) !== projectId) return null;

    const view: JobStatusView = {
      jobId: job.id,
      queue: job.queue,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      availableAt: job.availableAt,
    };
    if (job.leaseExpiresAt) view.leaseExpiresAt = job.leaseExpiresAt;
    return view;
  }

  async createPublish(command: CreatePublishCommand): Promise<{ jobId: string }> {
    await authorizeProjectCapability(
      this.dependencies.memberships,
      command.principal,
      command.request.projectId,
      'publish.create',
    );

    const jobId = `publish:${command.request.projectId}:${command.request.idempotencyKey}`;
    await this.dependencies.jobs.enqueue('publish', jobId, command.request, { maxAttempts: 5 });
    return { jobId };
  }

  async createMediaJob(command: CreateMediaJobCommand): Promise<{ jobId: string }> {
    await authorizeProjectCapability(
      this.dependencies.memberships,
      command.principal,
      command.projectId,
      'asset.write',
    );

    const asset = await this.dependencies.assets.getById(command.assetId);
    if (!asset || asset.projectId !== command.projectId) throw new Error('asset not found in project');

    await this.dependencies.jobs.enqueue('media', command.jobId, {
      projectId: command.projectId,
      assetId: command.assetId,
      transform: command.transform,
    });
    return { jobId: command.jobId };
  }
}

function projectIdFromPayload(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const projectId = (payload as Record<string, unknown>).projectId;
  return typeof projectId === 'string' && projectId.length > 0 ? projectId : null;
}
