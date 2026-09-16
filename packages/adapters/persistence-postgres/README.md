# PostgreSQL persistence adapter

Durable implementations for the VideoOS core ports:

- `MembershipRepository`
- `AssetRepository`
- `JobQueue`
- `EventOutbox`

Provider-specific `pg` types stay inside this adapter package.

## Local database

```bash
docker compose -f infra/compose.dev.yml up -d postgres
DATABASE_URL=postgres://videoos:videoos@localhost:5432/videoos \
  pnpm --filter @videoos/adapter-persistence-postgres migrate
```

## Transactional outbox

Use the same transaction client for durable state and outbox writes:

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

Leasing uses `FOR UPDATE SKIP LOCKED`. Delivery is at-least-once and expired leases are reclaimable, so all external side effects must remain idempotent.
