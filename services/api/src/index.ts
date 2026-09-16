import type { PublishRequest } from '@videoos/contracts';
import type { JobQueue } from '@videoos/job-queue';
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

export class VideoOsApi {
  constructor(private readonly dependencies: ApiDependencies) {}

  async listAssets(principal: Principal, projectId: string) {
    await authorizeProjectCapability(this.dependencies.memberships, principal, projectId, 'asset.read');
    return this.dependencies.assets.listByProject(projectId);
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
