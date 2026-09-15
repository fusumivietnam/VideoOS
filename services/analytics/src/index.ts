import type { AnalyticsEvent } from "@videoos/contracts";

export interface AnalyticsSink {
  ingest(event: AnalyticsEvent): Promise<void>;
}

export class InMemoryAnalyticsSink implements AnalyticsSink {
  private readonly events: AnalyticsEvent[] = [];

  async ingest(event: AnalyticsEvent): Promise<void> {
    this.events.push(structuredClone(event));
  }

  snapshot(): readonly AnalyticsEvent[] {
    return this.events.map((event) => structuredClone(event));
  }
}

export function validateAnalyticsEvent(event: AnalyticsEvent): void {
  if (event.name.trim().length === 0) {
    throw new Error("Analytics event name is required");
  }
  if (Number.isNaN(Date.parse(event.occurredAt))) {
    throw new Error("Analytics event occurredAt must be an ISO date-time string");
  }
}

export class AnalyticsService {
  constructor(private readonly sink: AnalyticsSink) {}

  async ingest(event: AnalyticsEvent): Promise<void> {
    validateAnalyticsEvent(event);
    await this.sink.ingest(event);
  }
}
