import type { EventEnvelope } from '@videoos/contracts';

export type EventHandler<T = unknown> = (event: EventEnvelope<T>) => Promise<void> | void;

export interface EventBus {
  publish<T>(event: EventEnvelope<T>): Promise<void>;
  subscribe<T>(topic: string, handler: EventHandler<T>): () => void;
}

export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();

  async publish<T>(event: EventEnvelope<T>): Promise<void> {
    const handlers = [...(this.handlers.get(event.type) ?? [])];
    await Promise.all(handlers.map((handler) => handler(event as EventEnvelope)));
  }

  subscribe<T>(topic: string, handler: EventHandler<T>): () => void {
    const handlers = this.handlers.get(topic) ?? new Set<EventHandler>();
    handlers.add(handler as EventHandler);
    this.handlers.set(topic, handlers);
    return () => handlers.delete(handler as EventHandler);
  }
}

export interface EventOutboxRecord {
  id: string;
  event: EventEnvelope;
  createdAt: string;
  deliveredAt?: string;
  attempts: number;
}

export interface EventOutbox {
  append(record: EventOutboxRecord): Promise<void>;
  pending(limit: number): Promise<EventOutboxRecord[]>;
  markDelivered(id: string, deliveredAt: string): Promise<void>;
  incrementAttempts(id: string): Promise<void>;
}

export class InMemoryEventOutbox implements EventOutbox {
  private readonly records = new Map<string, EventOutboxRecord>();

  async append(record: EventOutboxRecord): Promise<void> {
    if (this.records.has(record.id)) throw new Error(`duplicate outbox record: ${record.id}`);
    this.records.set(record.id, structuredClone(record));
  }

  async pending(limit: number): Promise<EventOutboxRecord[]> {
    return [...this.records.values()]
      .filter((record) => !record.deliveredAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }

  async markDelivered(id: string, deliveredAt: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`outbox record not found: ${id}`);
    record.deliveredAt = deliveredAt;
  }

  async incrementAttempts(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`outbox record not found: ${id}`);
    record.attempts += 1;
  }
}
