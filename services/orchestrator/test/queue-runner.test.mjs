import test from 'node:test';
import assert from 'node:assert/strict';

import { QueueRunner, retryDelayMs } from '../.test-dist/index.js';

function createQueue(job) {
  const calls = { complete: [], fail: [] };
  let nextJob = job;

  return {
    calls,
    port: {
      async enqueue() {},
      async get() { return nextJob; },
      async lease() {
        const leased = nextJob;
        nextJob = null;
        return leased;
      },
      async complete(id) { calls.complete.push(id); },
      async fail(id, error, retryAt) { calls.fail.push({ id, error, retryAt }); },
    },
  };
}

function createEventBus() {
  const events = [];
  return {
    events,
    port: {
      async publish(event) { events.push(event); },
    },
  };
}

function createSettlement() {
  const calls = { complete: [], fail: [] };
  return {
    calls,
    port: {
      async complete(jobId, event) { calls.complete.push({ jobId, event }); },
      async fail(jobId, error, retryAt, event) {
        calls.fail.push({ jobId, error, retryAt, event });
      },
    },
  };
}

function sequenceClock(...timestamps) {
  let index = 0;
  return () => {
    const value = timestamps[Math.min(index, timestamps.length - 1)];
    index += 1;
    return new Date(value);
  };
}

function sequenceIds() {
  let index = 0;
  return () => `event-${++index}`;
}

const baseJob = {
  id: 'job-1',
  queue: 'publish',
  payload: { projectId: 'project-1' },
  status: 'leased',
  attempts: 1,
  maxAttempts: 3,
  availableAt: '2026-09-16T00:00:00.000Z',
  leaseOwner: 'worker-a',
  leaseExpiresAt: '2026-09-16T00:00:30.000Z',
};

test('runOnce completes a leased job and emits lifecycle events', async () => {
  const queue = createQueue(structuredClone(baseJob));
  const eventBus = createEventBus();
  const handled = [];
  const runner = new QueueRunner(queue.port, eventBus.port, {
    workerId: 'worker-a',
    now: sequenceClock('2026-09-16T00:00:00.000Z', '2026-09-16T00:00:02.000Z'),
    idFactory: sequenceIds(),
  });

  const result = await runner.runOnce('publish', async (job) => {
    handled.push(job.id);
  });

  assert.deepEqual(result, { kind: 'completed', queue: 'publish', jobId: 'job-1', attempt: 1 });
  assert.deepEqual(handled, ['job-1']);
  assert.deepEqual(queue.calls.complete, ['job-1']);
  assert.deepEqual(eventBus.events.map((event) => event.type), [
    'job.execution.started',
    'job.execution.completed',
  ]);
  assert.equal(eventBus.events[1].occurredAt, '2026-09-16T00:00:02.000Z');
});

test('runOnce delegates completion and its lifecycle event to the settlement boundary', async () => {
  const queue = createQueue(structuredClone(baseJob));
  const eventBus = createEventBus();
  const settlement = createSettlement();
  const runner = new QueueRunner(queue.port, eventBus.port, {
    workerId: 'worker-a',
    settlement: settlement.port,
    now: sequenceClock('2026-09-16T00:00:00.000Z', '2026-09-16T00:00:02.000Z'),
    idFactory: sequenceIds(),
  });

  await runner.runOnce('publish', async () => {});

  assert.deepEqual(queue.calls.complete, []);
  assert.deepEqual(eventBus.events.map((event) => event.type), ['job.execution.started']);
  assert.equal(settlement.calls.complete.length, 1);
  assert.equal(settlement.calls.complete[0].jobId, 'job-1');
  assert.equal(settlement.calls.complete[0].event.type, 'job.execution.completed');
  assert.equal(settlement.calls.complete[0].event.payload.status, 'completed');
});

test('runOnce schedules a bounded retry after handler failure', async () => {
  const queue = createQueue(structuredClone(baseJob));
  const eventBus = createEventBus();
  const runner = new QueueRunner(queue.port, eventBus.port, {
    workerId: 'worker-a',
    baseRetryMs: 2_000,
    maxRetryMs: 10_000,
    now: sequenceClock('2026-09-16T00:00:00.000Z', '2026-09-16T00:00:05.000Z'),
    idFactory: sequenceIds(),
  });

  const result = await runner.runOnce('publish', async () => {
    throw new Error('rate limited');
  });

  assert.deepEqual(result, {
    kind: 'retry-scheduled',
    queue: 'publish',
    jobId: 'job-1',
    attempt: 1,
    retryAt: '2026-09-16T00:00:07.000Z',
    error: 'rate limited',
  });
  assert.deepEqual(queue.calls.fail, [{
    id: 'job-1',
    error: 'rate limited',
    retryAt: '2026-09-16T00:00:07.000Z',
  }]);
  assert.equal(eventBus.events.at(-1).payload.status, 'retry-scheduled');
  assert.equal(eventBus.events.at(-1).payload.retryAt, '2026-09-16T00:00:07.000Z');
});

test('runOnce delegates failure and its lifecycle event to the settlement boundary', async () => {
  const queue = createQueue(structuredClone(baseJob));
  const eventBus = createEventBus();
  const settlement = createSettlement();
  const runner = new QueueRunner(queue.port, eventBus.port, {
    workerId: 'worker-a',
    settlement: settlement.port,
    baseRetryMs: 2_000,
    now: sequenceClock('2026-09-16T00:00:00.000Z', '2026-09-16T00:00:05.000Z'),
    idFactory: sequenceIds(),
  });

  await runner.runOnce('publish', async () => {
    throw new Error('rate limited');
  });

  assert.deepEqual(queue.calls.fail, []);
  assert.deepEqual(eventBus.events.map((event) => event.type), ['job.execution.started']);
  assert.equal(settlement.calls.fail.length, 1);
  assert.equal(settlement.calls.fail[0].jobId, 'job-1');
  assert.equal(settlement.calls.fail[0].error, 'rate limited');
  assert.equal(settlement.calls.fail[0].retryAt, '2026-09-16T00:00:07.000Z');
  assert.equal(settlement.calls.fail[0].event.type, 'job.execution.failed');
  assert.equal(settlement.calls.fail[0].event.payload.status, 'retry-scheduled');
});

test('runOnce dead-letters the final failed attempt', async () => {
  const queue = createQueue({ ...structuredClone(baseJob), attempts: 3, maxAttempts: 3 });
  const eventBus = createEventBus();
  const runner = new QueueRunner(queue.port, eventBus.port, {
    workerId: 'worker-a',
    now: sequenceClock('2026-09-16T00:00:00.000Z', '2026-09-16T00:00:05.000Z'),
    idFactory: sequenceIds(),
  });

  const result = await runner.runOnce('publish', async () => {
    throw new Error('permanent failure');
  });

  assert.deepEqual(result, {
    kind: 'dead-letter',
    queue: 'publish',
    jobId: 'job-1',
    attempt: 3,
    error: 'permanent failure',
  });
  assert.equal(eventBus.events.at(-1).payload.status, 'dead-letter');
  assert.equal('retryAt' in eventBus.events.at(-1).payload, false);
});

test('retryDelayMs is exponential and bounded', () => {
  assert.equal(retryDelayMs(1, 1_000, 5_000), 1_000);
  assert.equal(retryDelayMs(2, 1_000, 5_000), 2_000);
  assert.equal(retryDelayMs(4, 1_000, 5_000), 5_000);
});
