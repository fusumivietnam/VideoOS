import type { MediaTransformRequest } from '@videoos/contracts';
import {
  assertLeaseValid,
  parseMediaNodeResult,
  type NodeExecutionRequirements,
  type NodeTaskBroker,
  type NodeTaskLease,
  type NodeTaskResult,
} from '../../../packages/node-protocol/src/index.js';
import type { MediaExecutionPlan, MediaExecutor } from '../../../services/media-worker/src/index.js';

export interface NodeTaskTransport {
  execute(lease: NodeTaskLease): Promise<NodeTaskResult>;
}

export interface LocalNodeMediaExecutorOptions {
  broker: NodeTaskBroker;
  transport: NodeTaskTransport;
  leaseMs?: number;
  requirements?:
    | NodeExecutionRequirements
    | ((plan: MediaExecutionPlan) => NodeExecutionRequirements | undefined);
}

export interface LocalMediaNodeAgentOptions {
  nodeId: string;
  executor: MediaExecutor;
  executorName?: string;
  executorVersion?: string;
  now?: () => Date;
}

export class LocalNodeExecutionError extends Error {
  constructor(
    readonly code: 'invalid-plan' | 'no-node' | 'transport-failed' | 'remote-failed' | 'invalid-result',
    message: string,
  ) {
    super(message);
    this.name = 'LocalNodeExecutionError';
  }
}

export class LocalNodeMediaExecutor implements MediaExecutor {
  private readonly leaseMs: number;

  constructor(private readonly options: LocalNodeMediaExecutorOptions) {
    this.leaseMs = positiveInteger(options.leaseMs ?? 5 * 60_000, 'local-node leaseMs');
  }

  async execute(plan: MediaExecutionPlan): Promise<{ assetId: string; uri: string }> {
    const context = plan.context;
    if (!context?.projectId || !context.jobId || !context.sourceObjectKey) {
      throw new LocalNodeExecutionError('invalid-plan', 'local-node execution requires project, job, and source-object context');
    }

    const cached = this.options.broker.getResult(context.jobId);
    if (cached?.status === 'succeeded') return mediaResult(cached);

    const requirements = typeof this.options.requirements === 'function'
      ? this.options.requirements(plan)
      : this.options.requirements;
    const request: MediaTransformRequest = {
      sourceAssetId: plan.sourceAssetId,
      ...(plan.preset ? { preset: structuredClone(plan.preset) } : {}),
      operations: structuredClone(plan.operations),
      output: structuredClone(plan.output),
    };
    const lease = this.options.broker.lease({
      taskId: context.jobId,
      projectId: context.projectId,
      leaseMs: this.leaseMs,
      payload: {
        kind: 'media-transform',
        request,
        sourceObjectKey: context.sourceObjectKey,
        ...(requirements ? { requirements: structuredClone(requirements) } : {}),
      },
    });
    if (!lease) {
      const completed = this.options.broker.getResult(context.jobId);
      if (completed?.status === 'succeeded') return mediaResult(completed);
      throw new LocalNodeExecutionError('no-node', 'no eligible local node is available for this media task');
    }

    let result: NodeTaskResult;
    try {
      result = await this.options.transport.execute(lease);
    } catch {
      this.options.broker.abandon(lease.leaseId);
      throw new LocalNodeExecutionError('transport-failed', 'local node disconnected before returning a result');
    }

    try {
      this.options.broker.acceptResult(result);
    } catch {
      this.options.broker.abandon(lease.leaseId);
      throw new LocalNodeExecutionError('invalid-result', 'local node returned a result that does not match its active lease');
    }

    const stored = this.options.broker.getResult(context.jobId) ?? result;
    if (stored.status === 'failed') {
      throw new LocalNodeExecutionError('remote-failed', sanitizeRemoteError(stored.error));
    }
    return mediaResult(stored);
  }
}

export class LocalMediaNodeAgent implements NodeTaskTransport {
  private readonly now: () => Date;
  private readonly executorName: string;

  constructor(private readonly options: LocalMediaNodeAgentOptions) {
    if (!options.nodeId.trim()) throw new Error('local media node agent requires nodeId');
    this.now = options.now ?? (() => new Date());
    this.executorName = options.executorName?.trim() || 'media-executor';
  }

  async execute(lease: NodeTaskLease): Promise<NodeTaskResult> {
    try {
      assertLeaseValid(lease, this.options.nodeId, this.now());
      if (lease.payload.kind !== 'media-transform') throw new Error('node lease is not a media task');

      const request = lease.payload.request;
      const result = await this.options.executor.execute({
        sourceAssetId: request.sourceAssetId,
        ...(request.preset ? { preset: structuredClone(request.preset) } : {}),
        operations: structuredClone(request.operations),
        output: structuredClone(request.output),
        context: {
          projectId: lease.projectId,
          jobId: lease.taskId,
          sourceObjectKey: lease.payload.sourceObjectKey,
        },
      });

      const output: Record<string, unknown> = {
        assetId: result.assetId,
        uri: result.uri,
        executor: this.executorName,
      };
      if (this.options.executorVersion) output.executorVersion = this.options.executorVersion;
      return {
        leaseId: lease.leaseId,
        taskId: lease.taskId,
        nodeId: this.options.nodeId,
        status: 'succeeded',
        output,
        completedAt: this.now().toISOString(),
      };
    } catch (error) {
      return {
        leaseId: lease.leaseId,
        taskId: lease.taskId,
        nodeId: this.options.nodeId,
        status: 'failed',
        error: boundedAgentError(error),
        completedAt: this.now().toISOString(),
      };
    }
  }
}

function mediaResult(result: NodeTaskResult): { assetId: string; uri: string } {
  try {
    const parsed = parseMediaNodeResult(result);
    return { assetId: parsed.assetId, uri: parsed.uri };
  } catch {
    throw new LocalNodeExecutionError('invalid-result', 'local node returned malformed media output');
  }
}

function sanitizeRemoteError(error: string | undefined): string {
  if (!error) return 'local node media execution failed';
  const normalized = error.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 512);
  return normalized ? `local node media execution failed: ${normalized}` : 'local node media execution failed';
}

function boundedAgentError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'local media node execution failed';
  return message.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 2_048) || 'local media node execution failed';
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}
