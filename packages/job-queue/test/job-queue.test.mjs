import test from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryJobQueue, exponentialBackoff } from '../.test-dist/index.js';

const t0 = new Date('2026-09-16T00:00:00.000Z');

 test('enqueue is idempotent and jobs are inspectable', async () => {
  const queue = new InMemoryJobQueue();

  await queue.enqueue('media', 'job-1', { version: 1 }, { maxAttempts: 3, availableAt: t0.toISOString() });
  await queue.enqueue('media', 'job-1', { version: 2 });

  const job = await queue.get('job-1');
  assert.equal(job?.status, 'ready');
  assert.equal(job?.maxAttempts, 3);
  assert.deepEqual(job?.payload, { version: 1 });
});

test('failed jobs respect retryAt and dead-letter on the final attempt', async () => {
  const queue = new InMemoryJobQueue();
  await queue.enqueue('publish', 'job-2', { target: 'youtube' }, { maxAttempts: 2, availableAt: t0.toISOString() });

  const first = await queue.lease('publish', 'worker-a', 1_000, t0);
  assert.equal(first?.attempts, 1);

  const retryAt = new Date(t0.getTime() + 5_000).toISOString();
  await queue.fail('job-2', 'temporary provider error', retryAt);

  assert.equal(await queue.lease('publish', 'worker-a', 1_000, new Date(t0.getTime() + 4_999)), null);

  const second = await queue.lease('publish', 'worker-a', 1_000, new Date(retryAt));
  assert.equal(second?.attempts, 2);
  await queue.fail('job-2', 'provider still unavailable', new Date(t0.getTime() + 10_000).toISOString());

  const final = await queue.get('job-2');
  assert.equal(final?.status, 'dead-letter');
  assert.equal(final?.lastError, 'provider still unavailable');
});

test('an expired final lease is dead-lettered instead of exceeding maxAttempts', async () => {
  const queue = new InMemoryJobQueue();
  await queue.enqueue('media', 'job-3', {}, { maxAttempts: 1, availableAt: t0.toISOString() });

  const leased = await queue.lease('media', 'worker-a', 1_000, t0);
  assert.equal(leased?.attempts, 1);

  const recovered = await queue.lease('media', 'worker-b', 1_000, new Date(t0.getTime() + 1_001));
  assert.equal(recovered, null);

  const final = await queue.get('job-3');
  assert.equal(final?.status, 'dead-letter');
  assert.equal(final?.attempts, 1);
  assert.equal(final?.lastError, 'lease expired after maximum attempts');
});

test('exponential backoff is bounded', () => {
  assert.equal(exponentialBackoff(1), 1_000);
  assert.equal(exponentialBackoff(2), 2_000);
  assert.equal(exponentialBackoff(20), 15 * 60_000);
});
