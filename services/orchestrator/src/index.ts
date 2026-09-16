import type { EventBusPort, EventEnvelope, JobRef, JobStatus } from "@videoos/contracts";

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
