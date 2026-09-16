export type QueueJobStatus = 'ready' | 'leased' | 'completed' | 'dead-letter';

export interface QueueJob<T = unknown> {
  id: string;
  queue: string;
  payload: T;
  status: QueueJobStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  lastError?: string;
}

export interface EnqueueOptions {
  maxAttempts?: number;
  availableAt?: string;
}

export interface JobQueue {
  enqueue<T>(queue: string, id: string, payload: T, options?: EnqueueOptions): Promise<void>;
  lease<T>(queue: string, workerId: string, leaseMs: number, now?: Date): Promise<QueueJob<T> | null>;
  complete(id: string): Promise<void>;
  fail(id: string, error: string, retryAt: string): Promise<void>;
}

export class InMemoryJobQueue implements JobQueue {
  private readonly jobs = new Map<string, QueueJob>();

  async enqueue<T>(queue: string, id: string, payload: T, options: EnqueueOptions = {}): Promise<void> {
    if (this.jobs.has(id)) return;
    this.jobs.set(id, {
      id,
      queue,
      payload,
      status: 'ready',
      attempts: 0,
      maxAttempts: options.maxAttempts ?? 5,
      availableAt: options.availableAt ?? new Date().toISOString(),
    });
  }

  async lease<T>(queue: string, workerId: string, leaseMs: number, now = new Date()): Promise<QueueJob<T> | null> {
    const nowIso = now.toISOString();
    const candidate = [...this.jobs.values()]
      .filter((job) => job.queue === queue)
      .filter((job) => job.status === 'ready' || (job.status === 'leased' && !!job.leaseExpiresAt && job.leaseExpiresAt <= nowIso))
      .filter((job) => job.availableAt <= nowIso)
      .sort((a, b) => a.availableAt.localeCompare(b.availableAt))[0];

    if (!candidate) return null;
    candidate.status = 'leased';
    candidate.leaseOwner = workerId;
    candidate.leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
    candidate.attempts += 1;
    return structuredClone(candidate) as QueueJob<T>;
  }

  async complete(id: string): Promise<void> {
    const job = this.requireJob(id);
    job.status = 'completed';
    delete job.leaseOwner;
    delete job.leaseExpiresAt;
  }

  async fail(id: string, error: string, retryAt: string): Promise<void> {
    const job = this.requireJob(id);
    job.lastError = error;
    delete job.leaseOwner;
    delete job.leaseExpiresAt;
    if (job.attempts >= job.maxAttempts) {
      job.status = 'dead-letter';
      return;
    }
    job.status = 'ready';
    job.availableAt = retryAt;
  }

  private requireJob(id: string): QueueJob {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`queue job not found: ${id}`);
    return job;
  }
}

export function exponentialBackoff(attempt: number, baseMs = 1_000, maxMs = 15 * 60_000): number {
  return Math.min(baseMs * 2 ** Math.max(attempt - 1, 0), maxMs);
}
