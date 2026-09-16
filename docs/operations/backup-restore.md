# Durable backup and restore

This runbook covers the M2 durable setup: PostgreSQL for control-plane state plus either the local filesystem `ObjectStore` edge or an S3-compatible object store for media bytes.

## Consistency model

PostgreSQL is the source of truth for project membership, asset metadata, queue state, outbox records, and publisher idempotency values. Object bytes live outside PostgreSQL and are addressed by deterministic project-scoped object keys.

For a fully consistent backup, pause new API writes and workers before taking the database dump and object-store checkpoint. Do not delete pending queue jobs or undelivered outbox rows before backup; they are recovery state.

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

## S3-compatible object-store backup

For AWS S3, MinIO, R2, or another S3-compatible deployment, prefer provider-native versioning/replication or a bucket-level backup policy. VideoOS must not treat PostgreSQL asset metadata as a replacement for backing up object bytes.

For a portable checkpoint, mirror the configured bucket while preserving keys exactly. With an S3-compatible CLI this is conceptually:

```bash
aws s3 sync s3://$OBJECT_BUCKET .backup/objects-s3/ \
  --endpoint-url "$OBJECT_ENDPOINT"
```

For AWS S3 itself, omit `--endpoint-url`. For MinIO or R2, use the provider endpoint and credentials supplied by the deployment environment. Never commit access keys or generated signed URLs to the repository.

If provider versioning is enabled, record the checkpoint time/version policy alongside the PostgreSQL dump. Recovery should restore object bytes to the same deterministic `projects/<projectId>/...` keys before workers resume.

## Restore

1. Stop API writers and workers.
2. Restore object bytes to the configured object store, preserving relative/project-scoped keys.
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
6. Validate that critical asset object keys referenced by PostgreSQL exist in the selected filesystem/S3-compatible store.
7. Resume workers, then API writes.

## S3-compatible restore notes

When restoring into a new S3-compatible backend, keep object keys unchanged and change only trusted application-edge configuration such as bucket, region, endpoint, path-style behavior, and credentials. The core `ObjectStore` contract and asset metadata should not need provider-specific migration.

A provider migration must verify at least a representative sample of object size/checksum metadata before traffic resumes. Signed read URLs are ephemeral and must be regenerated after recovery; they are never durable state.

## Recovery semantics

- `ready` queue jobs remain eligible for execution after restore.
- `leased` jobs are reclaimed after lease expiry; at-least-once execution means provider side effects must remain idempotent.
- Undelivered outbox records remain pending and should be dispatched after recovery.
- Terminal queue transitions and their lifecycle outbox records are transactionally committed together.
- Asset metadata may reference missing bytes if database and object checkpoints come from different times. Before resuming production traffic, validate that critical asset object keys exist in the restored store.
- Restoring an older checkpoint can replay work or external reconciliation. Publisher/network adapters must continue to use idempotency keys and remote-state reconciliation.
- S3 provider credentials, endpoints, and bucket policy are deployment configuration; they are not restored from public/browser contracts.

## Health semantics

`createPostgresRuntime()` exposes:

- `liveness()` — process-level signal only; it does not contact PostgreSQL.
- `readiness()` — verifies PostgreSQL connectivity and the required migration set. It returns bounded status fields and migration names only; raw database/provider errors and credentials are not exposed.

A runtime is ready only when both the database and required migrations are ready. Object-store provider health can be added later as a bounded readiness dependency once object upload becomes a required startup capability rather than an optional adapter selection.
