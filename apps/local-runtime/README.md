# Runtime composition

This app contains executable composition roots for the VideoOS vertical slice. Domain/services remain provider-neutral; concrete persistence is selected here at the application edge.

## In-memory runtime

`createInMemoryRuntime(...)` wires the API facade, in-memory identity/storage/queue/event adapters, deterministic queue runner, media worker, and publisher service.

The smoke test proves both canonical paths:

- `API -> queue(media) -> QueueRunner -> MediaWorker -> MediaExecutor`
- `API -> queue(publish) -> QueueRunner -> PublisherService -> NetworkPublisherAdapter`

Both paths emit lifecycle events and are observable through the project-authorized job-status API.

Run with:

```bash
pnpm --filter @videoos/local-runtime test
```

## PostgreSQL runtime

`createPostgresRuntime(...)` replaces membership, asset metadata, queue state, event outbox, and publisher idempotency storage with PostgreSQL implementations while keeping the same runtime orchestration.

Before constructing it, run migrations:

```bash
docker compose -f infra/compose.dev.yml up -d postgres
DATABASE_URL=postgres://videoos:videoos@localhost:5432/videoos \
  pnpm --filter @videoos/adapter-persistence-postgres migrate
```

The Postgres runtime persists lifecycle events to the transactional outbox and persists publisher idempotency values. Queue settlement and lifecycle outbox append are still separate writes at this stage; M2 must close that atomicity gap before claiming restart-safe workflow completion.
