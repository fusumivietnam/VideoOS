# PostgreSQL persistence adapter

Durable implementations for the VideoOS core ports and runtime support:

- project membership repository
- asset metadata repository
- job queue
- event outbox
- event-bus-to-outbox writer
- namespaced JSON value store for small durable control-plane values such as publisher idempotency receipts

Provider-specific `pg` types stay inside this adapter package.

## Local database

```bash
docker compose -f infra/compose.dev.yml up -d postgres
DATABASE_URL=postgres://videoos:videoos@localhost:5432/videoos \
  pnpm --filter @videoos/adapter-persistence-postgres migrate
DATABASE_URL=postgres://videoos:videoos@localhost:5432/videoos \
  pnpm --filter @videoos/adapter-persistence-postgres test:integration
```

## Transactional outbox

Use the same transaction client for durable state and outbox writes when a state transition must be atomic:

```ts
await withTransaction(pool, async (client) => {
  const assets = new PostgresAssetRepository(client);
  const outbox = new PostgresEventOutbox(client);
  await assets.create(asset);
  await outbox.append(event);
});
```

External event publication happens after commit through an outbox dispatcher.

## Queue semantics

Leasing uses `FOR UPDATE SKIP LOCKED`. Delivery is at-least-once and expired leases are reclaimable while attempts remain. An expired lease that already consumed the final allowed attempt is moved to `dead-letter` instead of being leased again. External side effects must remain idempotent.

The current generic queue runner still settles queue state and writes lifecycle events in separate operations. The Postgres composition persists both, but M2 must make settlement + outbox append atomic before the durable runtime is considered restart-safe at the completion boundary.
