# Durable backup and restore

This runbook covers the current local-first M2 durable setup: PostgreSQL for control-plane state and the local filesystem `ObjectStore` edge for media bytes. Provider-backed S3 procedures will be added when VID-2 phase B lands.

## Consistency model

PostgreSQL is the source of truth for project membership, asset metadata, queue state, outbox records, and publisher idempotency values. Object bytes live outside PostgreSQL and are addressed by deterministic project-scoped object keys.

For a fully consistent backup, pause new API writes and workers before taking the database dump and object-store snapshot. Do not delete pending queue jobs or undelivered outbox rows before backup; they are recovery state.

## PostgreSQL backup

With the local Compose database running:

```bash
mkdir -p .backup
PGPASSWORD=videoos pg_dump \
  --host localhost \
  --port 5432 \
  --username videoos \
  --dbname videoos \
  --format custom \
  --file .backup/videoos.dump
```

Record the application revision and migration set alongside the dump. `schema_migrations` must contain every migration required by the revision being restored.

## Filesystem object-store backup

The runtime object-store root is deployment configuration. Back up that root without changing relative keys. For a local development root such as `.data/objects`:

```bash
mkdir -p .backup/objects
rsync -a --delete .data/objects/ .backup/objects/
```

Treat database dump + object snapshot as one recovery checkpoint.

## Restore

1. Stop API writers and workers.
2. Restore object bytes to the configured object-store root, preserving relative keys.
3. Restore PostgreSQL into an empty database:

```bash
PGPASSWORD=videoos pg_restore \
  --host localhost \
  --port 5432 \
  --username videoos \
  --dbname videoos \
  --clean \
  --if-exists \
  .backup/videoos.dump
```

4. Run the normal migration command to bring the restored database forward if the application revision is newer than the checkpoint:

```bash
DATABASE_URL=postgres://videoos:videoos@localhost:5432/videoos \
  pnpm --filter @videoos/adapter-persistence-postgres migrate
```

5. Verify durable runtime readiness before starting workers.
6. Resume workers, then API writes.

## Recovery semantics

- `ready` queue jobs remain eligible for execution after restore.
- `leased` jobs are reclaimed after lease expiry; at-least-once execution means provider side effects must remain idempotent.
- Undelivered outbox records remain pending and should be dispatched after recovery.
- Terminal queue transitions and their lifecycle outbox records are transactionally committed together.
- Asset metadata may reference missing bytes if database and object snapshots come from different checkpoints. Before resuming production traffic, validate that critical asset object keys exist in the restored store.
- Restoring an older checkpoint can replay work or external reconciliation. Publisher/network adapters must continue to use idempotency keys and remote-state reconciliation.

## Health semantics

`createPostgresRuntime()` exposes:

- `liveness()` — process-level signal only; it does not contact PostgreSQL.
- `readiness()` — verifies PostgreSQL connectivity and the required migration set. It returns bounded status fields and migration names only; raw database/provider errors and credentials are not exposed.

A runtime is ready only when both the database and required migrations are ready.
