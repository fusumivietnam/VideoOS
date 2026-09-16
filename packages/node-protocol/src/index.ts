import type { AiTaskRequest, MediaTransformRequest } from '@videoos/contracts';

export type NodeCapability = 'media.ffmpeg' | 'ai.local' | 'editor.bridge';

export interface NodeResourceProfile {
  cpuCores?: number;
  memoryBytes?: number;
  accelerators?: Array<{
    kind: 'gpu';
    name?: string;
    memoryBytes?: number;
  }>;
}

export interface NodeExecutionRequirements {
  accelerator?: 'gpu';
  minMemoryBytes?: number;
}

export interface NodeRegistration {
  nodeId: string;
  projectId: string;
  name: string;
  capabilities: NodeCapability[];
  platform: 'windows' | 'macos' | 'linux';
  version: string;
  resources?: NodeResourceProfile;
  registeredAt: string;
}

export interface NodeHeartbeat {
  nodeId: string;
  at: string;
  activeLeases: number;
  cpuLoad?: number;
  freeMemoryBytes?: number;
  freeDiskBytes?: number;
}

export type NodeTaskPayload =
  | {
      kind: 'media-transform';
      request: MediaTransformRequest;
      sourceObjectKey: string;
      requirements?: NodeExecutionRequirements;
    }
  | { kind: 'ai-task'; request: AiTaskRequest }
  | { kind: 'editor-command'; editor: string; command: string; args?: Record<string, unknown> };

export interface NodeTaskLease {
  leaseId: string;
  taskId: string;
  nodeId: string;
  projectId: string;
  payload: NodeTaskPayload;
  leasedAt: string;
  expiresAt: string;
}

export interface NodeTaskResult {
  leaseId: string;
  taskId: string;
  nodeId: string;
  status: 'succeeded' | 'failed';
  output?: Record<string, unknown>;
  error?: string;
  completedAt: string;
}

export interface NodeLeaseRequest {
  taskId: string;
  projectId: string;
  payload: NodeTaskPayload;
  leaseMs: number;
}

export interface NodeTaskBroker {
  register(node: NodeRegistration): void;
  lease(request: NodeLeaseRequest): NodeTaskLease | null;
  acceptResult(result: NodeTaskResult): 'accepted' | 'duplicate';
  abandon(leaseId: string): void;
  getResult(taskId: string): NodeTaskResult | null;
}

export function nodeCanExecute(node: NodeRegistration, payload: NodeTaskPayload): boolean {
  if (payload.kind === 'media-transform') {
    if (!node.capabilities.includes('media.ffmpeg')) return false;
    return resourcesSatisfy(node.resources, payload.requirements);
  }
  if (payload.kind === 'ai-task') return node.capabilities.includes('ai.local');
  return node.capabilities.includes('editor.bridge');
}

export function assertLeaseValid(lease: NodeTaskLease, nodeId: string, now = new Date()): void {
  if (lease.nodeId !== nodeId) throw new Error('lease belongs to another node');
  if (lease.expiresAt <= now.toISOString()) throw new Error('lease expired');
}

export class InMemoryNodeTaskBroker implements NodeTaskBroker {
  private readonly nodes = new Map<string, NodeRegistration>();
  private readonly leases = new Map<string, NodeTaskLease>();
  private readonly taskLeaseIds = new Map<string, string>();
  private readonly results = new Map<string, NodeTaskResult>();
  private readonly leaseSequences = new Map<string, number>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  register(node: NodeRegistration): void {
    if (!node.nodeId || !node.projectId) throw new Error('node registration requires node and project ids');
    this.nodes.set(node.nodeId, structuredClone(node));
  }

  lease(request: NodeLeaseRequest): NodeTaskLease | null {
    if (!Number.isSafeInteger(request.leaseMs) || request.leaseMs <= 0) {
      throw new Error('node leaseMs must be a positive integer');
    }
    const completed = this.results.get(request.taskId);
    if (completed?.status === 'succeeded') return null;

    this.reclaimExpiredLeases();
    const existingLeaseId = this.taskLeaseIds.get(request.taskId);
    if (existingLeaseId && this.leases.has(existingLeaseId)) return null;

    const candidates = [...this.nodes.values()]
      .filter((node) => node.projectId === request.projectId && nodeCanExecute(node, request.payload))
      .sort((left, right) => {
        const activeDelta = this.activeLeaseCount(left.nodeId) - this.activeLeaseCount(right.nodeId);
        return activeDelta || left.nodeId.localeCompare(right.nodeId);
      });
    const node = candidates[0];
    if (!node) return null;

    const now = this.now();
    const sequence = (this.leaseSequences.get(request.taskId) ?? 0) + 1;
    this.leaseSequences.set(request.taskId, sequence);
    const lease: NodeTaskLease = {
      leaseId: `node-lease:${request.taskId}:${sequence}`,
      taskId: request.taskId,
      nodeId: node.nodeId,
      projectId: request.projectId,
      payload: structuredClone(request.payload),
      leasedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + request.leaseMs).toISOString(),
    };
    this.leases.set(lease.leaseId, lease);
    this.taskLeaseIds.set(request.taskId, lease.leaseId);
    return structuredClone(lease);
  }

  acceptResult(result: NodeTaskResult): 'accepted' | 'duplicate' {
    const existing = this.results.get(result.taskId);
    if (existing && sameResult(existing, result)) return 'duplicate';
    if (existing?.status === 'succeeded') throw new Error('conflicting duplicate node result');

    const lease = this.leases.get(result.leaseId);
    if (!lease || lease.taskId !== result.taskId || lease.nodeId !== result.nodeId) {
      throw new Error('node result does not match an active lease');
    }
    assertLeaseValid(lease, result.nodeId, this.now());

    const normalized = normalizeNodeResult(result);
    this.results.set(result.taskId, normalized);
    this.leases.delete(result.leaseId);
    this.taskLeaseIds.delete(result.taskId);
    return 'accepted';
  }

  abandon(leaseId: string): void {
    const lease = this.leases.get(leaseId);
    if (!lease) return;
    this.leases.delete(leaseId);
    if (this.taskLeaseIds.get(lease.taskId) === leaseId) this.taskLeaseIds.delete(lease.taskId);
  }

  getResult(taskId: string): NodeTaskResult | null {
    const result = this.results.get(taskId);
    return result ? structuredClone(result) : null;
  }

  private reclaimExpiredLeases(): void {
    const nowIso = this.now().toISOString();
    for (const [leaseId, lease] of this.leases) {
      if (lease.expiresAt > nowIso) continue;
      this.leases.delete(leaseId);
      if (this.taskLeaseIds.get(lease.taskId) === leaseId) this.taskLeaseIds.delete(lease.taskId);
    }
  }

  private activeLeaseCount(nodeId: string): number {
    let count = 0;
    for (const lease of this.leases.values()) if (lease.nodeId === nodeId) count += 1;
    return count;
  }
}

export function parseMediaNodeResult(result: NodeTaskResult): {
  assetId: string;
  uri: string;
  executor: string;
  executorVersion?: string;
} {
  if (result.status !== 'succeeded' || !result.output) throw new Error('node media task did not succeed');
  const assetId = result.output.assetId;
  const uri = result.output.uri;
  const executor = result.output.executor;
  const executorVersion = result.output.executorVersion;
  if (typeof assetId !== 'string' || !assetId || typeof uri !== 'string' || !uri || typeof executor !== 'string' || !executor) {
    throw new Error('node media result is malformed');
  }
  if (executorVersion !== undefined && typeof executorVersion !== 'string') throw new Error('node media result version is malformed');
  return {
    assetId,
    uri,
    executor,
    ...(typeof executorVersion === 'string' ? { executorVersion } : {}),
  };
}

function resourcesSatisfy(resources: NodeResourceProfile | undefined, requirements: NodeExecutionRequirements | undefined): boolean {
  if (!requirements) return true;
  if (requirements.minMemoryBytes !== undefined) {
    if (!Number.isFinite(requirements.minMemoryBytes) || requirements.minMemoryBytes <= 0) return false;
    if ((resources?.memoryBytes ?? 0) < requirements.minMemoryBytes) return false;
  }
  if (requirements.accelerator === 'gpu') {
    if (!resources?.accelerators?.some((accelerator) => accelerator.kind === 'gpu')) return false;
  }
  return true;
}

function normalizeNodeResult(result: NodeTaskResult): NodeTaskResult {
  const normalized: NodeTaskResult = {
    leaseId: result.leaseId,
    taskId: result.taskId,
    nodeId: result.nodeId,
    status: result.status,
    completedAt: result.completedAt,
  };
  if (result.output) normalized.output = structuredClone(result.output);
  if (result.error) normalized.error = result.error.slice(0, 2_048);
  return normalized;
}

function sameResult(left: NodeTaskResult, right: NodeTaskResult): boolean {
  return left.leaseId === right.leaseId
    && left.nodeId === right.nodeId
    && left.status === right.status
    && left.error === right.error
    && JSON.stringify(left.output ?? null) === JSON.stringify(right.output ?? null);
}
