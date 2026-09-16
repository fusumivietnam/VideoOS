import type { AiTask, MediaTransformRequest } from '@videoos/contracts';

export type NodeCapability = 'media.ffmpeg' | 'ai.local' | 'editor.bridge';

export interface NodeRegistration {
  nodeId: string;
  projectId: string;
  name: string;
  capabilities: NodeCapability[];
  platform: 'windows' | 'macos' | 'linux';
  version: string;
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
  | { kind: 'media-transform'; request: MediaTransformRequest }
  | { kind: 'ai-task'; request: AiTask }
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

export function nodeCanExecute(node: NodeRegistration, payload: NodeTaskPayload): boolean {
  if (payload.kind === 'media-transform') return node.capabilities.includes('media.ffmpeg');
  if (payload.kind === 'ai-task') return node.capabilities.includes('ai.local');
  return node.capabilities.includes('editor.bridge');
}

export function assertLeaseValid(lease: NodeTaskLease, nodeId: string, now = new Date()): void {
  if (lease.nodeId !== nodeId) throw new Error('lease belongs to another node');
  if (lease.expiresAt <= now.toISOString()) throw new Error('lease expired');
}
