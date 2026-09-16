# PostgreSQL persistence adapter

Durable implementations for the VideoOS core ports:

- `MembershipRepository`
- `AssetRepository`
- `JobQueue`
- `EventOutbox`

Provider-specific `pg` types stay inside this adapter package.

## Local database

Start the development database:

```bash
docker compose -f infra/compose.dev.yml up -d postgres
```

Run migrations:

```bash
DATABASE_URL=postgres://videoos:videoos@localhost:5432/videoos \
  pnpm --filter @videoos/adapter-persistence-postgres migrate
```

## Transactional outbox

`PostgresMembershipRepository`, `PostgresAssetRepository`, and `PostgresEventOutbox` accept a generic `Queryable`. To atomically mutate durable state and append an outbox event, construct repositories with the `PoolClient` supplied by `withTransaction`:

```ts
await withTransaction(pool, async (client) => {
  const assets = new PostgresAssetRepository(client);
  const outbox = new PostgresEventOutbox(client);

  await assets.create(asset);
  await outbox.append(event);
});
```

Do not publish to the external event bus inside the database transaction. A dispatcher should publish committed outbox rows and then mark them delivered.

## Queue semantics

The queue uses PostgreSQL row locking with `FOR UPDATE SKIP LOCKED`. Delivery is at-least-once: expired leases can be acquired by another worker, so external side effects must remain idempotent.
