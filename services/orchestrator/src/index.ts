import type { EventBusPort, EventEnvelope, JobRef, JobStatus } from "@videoos/contracts";
import type { JobQueue, QueueJob } from "@videoos/job-queue";

export type OrchestratorCommand =
  | { type: "start" }
  | { type: "succeed" }
  | { type: "fail"; reason: string }
  | { type: "cancel" };

const transitions: Record<JobStatus, Partial<Record<OrchestratorCommand["type"], JobStatus>>> = {
  queued: { start: "running", cancel: "cancelled" },
  running: { succeed: "succeeded", fail: "failed", cancel: "cancelled" },
  succeeded: {},
  failed: {},
  cancelled: {},
};

export function transition(job: JobRef, command: OrchestratorCommand, now: string): JobRef {
  const next = transitions[job.status][command.type];
  if (!next) {
    throw new Error(`Invalid job transition: ${job.status} -> ${command.type}`);
  }

  return {
    ...job,
    status: next,
    updatedAt: now,
  };
}

export class Orchestrator {
  constructor(private readonly eventBus: EventBusPort) {}

  async apply(job: JobRef, command: OrchestratorCommand, now: string): Promise<JobRef> {
    const next = transition(job, command, now);
    const event: EventEnvelope<"job.status.changed", { jobId: string; from: JobStatus; to: JobStatus; reason?: string }> = {
      id: crypto.randomUUID(),
      type: "job.status.changed",
      version: 1,
      occurredAt: now,
      correlationId: job.id,
      payload: {
        jobId: job.id,
        from: job.status,
        to: next.status,
        ...(command.type === "fail" ? { reason: command.reason } : {}),
      },
    };

    await this.eventBus.publish(event);
    return next;
  }
}

export type QueueJobHandler<TPayload> = (job: QueueJob<TPayload>) => Promise<void>;

export interface QueueRunnerOptions {
  workerId: string;
  leaseMs?: number;
  baseRetryMs?: number;
  maxRetryMs?: number;
  now?: () => Date;
  idFactory?: () => string;
}

export type QueueRunResult =
  | { kind: "idle"; queue: string }
  | { kind: "completed"; queue: string; jobId: string; attempt: number }
  | { kind: "retry-scheduled"; queue: string; jobId: string; attempt: number; retryAt: string; error: string }
  | { kind: "dead-letter"; queue: string; jobId: string; attempt: number; error: string };

export class QueueRunner {
  private readonly workerId: string;
  private readonly leaseMs: number;
  private readonly baseRetryMs: number;
  private readonly maxRetryMs: number;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(
    private readonly queue: JobQueue,
    private readonly eventBus: EventBusPort,
    options: QueueRunnerOptions,
  ) {
    if (!options.workerId.trim()) throw new Error("workerId is required");
    if ((options.leaseMs ?? 30_000) <= 0) throw new Error("leaseMs must be positive");
    if ((options.baseRetryMs ?? 1_000) <= 0) throw new Error("baseRetryMs must be positive");
    if ((options.maxRetryMs ?? 15 * 60_000) <= 0) throw new Error("maxRetryMs must be positive");

    this.workerId = options.workerId;
    this.leaseMs = options.leaseMs ?? 30_000;
    this.baseRetryMs = options.baseRetryMs ?? 1_000;
    this.maxRetryMs = options.maxRetryMs ?? 15 * 60_000;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
  }

  async runOnce<TPayload>(queueName: string, handler: QueueJobHandler<TPayload>): Promise<QueueRunResult> {
    const leaseTime = this.now();
    const job = await this.queue.lease<TPayload>(queueName, this.workerId, this.leaseMs, leaseTime);
    if (!job) return { kind: "idle", queue: queueName };

    await this.publishLifecycleEvent("job.execution.started", job, leaseTime.toISOString(), {
      status: "running",
    });

    try {
      await handler(job);
      await this.queue.complete(job.id);
      const completedAt = this.now().toISOString();
      await this.publishLifecycleEvent("job.execution.completed", job, completedAt, {
        status: "completed",
      });
      return { kind: "completed", queue: queueName, jobId: job.id, attempt: job.attempts };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedAt = this.now();
      const deadLetter = job.attempts >= job.maxAttempts;
      const retryAt = new Date(
        failedAt.getTime() + retryDelayMs(job.attempts, this.baseRetryMs, this.maxRetryMs),
      ).toISOString();

      await this.queue.fail(job.id, message, retryAt);
      await this.publishLifecycleEvent("job.execution.failed", job, failedAt.toISOString(), {
        status: deadLetter ? "dead-letter" : "retry-scheduled",
        error: message,
        ...(deadLetter ? {} : { retryAt }),
      });

      if (deadLetter) {
        return { kind: "dead-letter", queue: queueName, jobId: job.id, attempt: job.attempts, error: message };
      }

      return {
        kind: "retry-scheduled",
        queue: queueName,
        jobId: job.id,
        attempt: job.attempts,
        retryAt,
        error: message,
      };
    }
  }

  private async publishLifecycleEvent(
    type: "job.execution.started" | "job.execution.completed" | "job.execution.failed",
    job: QueueJob,
    occurredAt: string,
    detail: Record<string, string>,
  ): Promise<void> {
    await this.eventBus.publish({
      id: this.idFactory(),
      type,
      version: 1,
      occurredAt,
      correlationId: job.id,
      payload: {
        jobId: job.id,
        queue: job.queue,
        workerId: this.workerId,
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
        ...detail,
      },
    });
  }
}

export function retryDelayMs(attempt: number, baseMs = 1_000, maxMs = 15 * 60_000): number {
  return Math.min(baseMs * 2 ** Math.max(attempt - 1, 0), maxMs);
}
