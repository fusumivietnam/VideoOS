import type { MediaTransformRequest, PublishRequest } from '@videoos/contracts';
import type { JobQueue, QueueJobStatus } from '@videoos/job-queue';
import type { MembershipRepository, Principal, ProjectRole } from '@videoos/identity';
import { authorizeProjectCapability } from '@videoos/identity';
import type { AssetRepository } from '@videoos/storage';

export interface ApiDependencies {
  memberships: MembershipRepository;
  assets: AssetRepository;
  jobs: JobQueue;
}

export interface ProjectMembershipView {
  projectId: string;
  role: ProjectRole;
}

export interface PublishApprovalRecord {
  approvedBy: Principal;
  approvedAt: string;
}

export interface PublishJobPayload {
  projectId: string;
  request: PublishRequest;
  approval: PublishApprovalRecord;
}

export interface CreatePublishCommand {
  principal: Principal;
  request: PublishRequest;
  approval?: PublishApprovalRecord;
}

export interface PublishPreflightView {
  projectId: string;
  assetCount: number;
  targetCount: number;
  scheduled: boolean;
  approvalRequired: true;
}

export interface MediaJobPayload {
  projectId: string;
  assetId: string;
  transform: Omit<MediaTransformRequest, 'sourceAssetId'>;
}

export interface CreateMediaJobCommand extends MediaJobPayload {
  principal: Principal;
  jobId: string;
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

  async listProjects(principal: Principal): Promise<ProjectMembershipView[]> {
    const memberships = await this.dependencies.memberships.listByPrincipal(principal.id);
    return memberships.map((membership) => ({ projectId: membership.projectId, role: membership.role }));
  }

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

  async preflightPublish(principal: Principal, request: PublishRequest): Promise<PublishPreflightView> {
    await authorizeProjectCapability(
      this.dependencies.memberships,
      principal,
      request.projectId,
      'publish.create',
    );
    await this.validatePublishRequest(request);
    return {
      projectId: request.projectId,
      assetCount: request.assets.length,
      targetCount: request.targets.length,
      scheduled: Boolean(request.scheduledAt),
      approvalRequired: true,
    };
  }

  async createPublish(command: CreatePublishCommand): Promise<{ jobId: string }> {
    await this.preflightPublish(command.principal, command.request);

    if (!command.approval) throw new Error('publish approval required');
    await authorizeProjectCapability(
      this.dependencies.memberships,
      command.approval.approvedBy,
      command.request.projectId,
      'publish.manage',
    );

    if (!isValidIsoDateTime(command.approval.approvedAt)) throw new Error('publish approval timestamp is invalid');

    const jobId = `publish:${command.request.projectId}:${command.request.idempotencyKey}`;
    const payload: PublishJobPayload = {
      projectId: command.request.projectId,
      request: command.request,
      approval: {
        approvedBy: { ...command.approval.approvedBy },
        approvedAt: command.approval.approvedAt,
      },
    };
    await this.dependencies.jobs.enqueue('publish', jobId, payload, { maxAttempts: 5 });
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

    const payload: MediaJobPayload = {
      projectId: command.projectId,
      assetId: command.assetId,
      transform: command.transform,
    };
    await this.dependencies.jobs.enqueue('media', command.jobId, payload);
    return { jobId: command.jobId };
  }

  private async validatePublishRequest(request: PublishRequest): Promise<void> {
    if (request.scheduledAt && !isValidIsoDateTime(request.scheduledAt)) {
      throw new Error('publish scheduledAt is invalid');
    }

    for (const asset of request.assets) {
      const record = await this.dependencies.assets.getById(asset.assetId);
      if (!record || record.projectId !== request.projectId) {
        throw new Error('publish asset not found in project');
      }
    }
  }
}

function projectIdFromPayload(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.projectId === 'string' && value.projectId.length > 0) return value.projectId;
  const request = value.request;
  if (typeof request !== 'object' || request === null || Array.isArray(request)) return null;
  const projectId = (request as Record<string, unknown>).projectId;
  return typeof projectId === 'string' && projectId.length > 0 ? projectId : null;
}

function isValidIsoDateTime(value: string): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}
