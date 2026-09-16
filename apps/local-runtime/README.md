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

## Local filesystem object storage

`FileSystemObjectStore` is the zero-managed-service development implementation of the existing `ObjectStore` contract. It lives at the application edge and requires no provider SDK or lockfile change.

It:

- resolves object keys beneath one configured root directory;
- rejects absolute, traversal, ambiguous, and backslash-separated keys;
- verifies optional SHA-256 checksums before committing a write;
- writes through a temporary file and rename so incomplete content is not exposed as the final object;
- treats deletion of a missing object as idempotent.

Example:

```ts
import { FileSystemObjectStore } from './src/filesystem-object-store.js';

const objects = new FileSystemObjectStore('.videoos/objects');
await objects.put({
  key: 'projects/project-1/assets/asset-1/source.mp4',
  contentType: 'video/mp4',
  body,
  checksumSha256,
});
```

The local filesystem adapter deliberately does **not** return `file://` paths as signed URLs. `signedReadUrl(...)` fails explicitly. The S3-compatible deployment adapter, including provider-backed signed URLs, remains the next part of VID-2 rather than being simulated locally.

## PostgreSQL runtime

`createPostgresRuntime(...)` replaces membership, asset metadata, queue state, event outbox, and publisher idempotency storage with PostgreSQL implementations while keeping the same runtime orchestration.

Before constructing it, run migrations:

```bash
docker compose -f infra/compose.dev.yml up -d postgres
DATABASE_URL=postgres://videoos:videoos@localhost:5432/videoos \
  pnpm --filter @videoos/adapter-persistence-postgres migrate
```

The Postgres runtime persists lifecycle events to the transactional outbox and publisher idempotency values. Terminal queue settlement (`complete`/`fail`) and the corresponding lifecycle outbox append share one PostgreSQL transaction through the queue-settlement port, so a failed outbox append rolls back the queue transition.

Lease acquisition and the informational `job.execution.started` event remain separate operations. A crash after lease acquisition is recovered through lease expiry/retry semantics; correctness-critical terminal state is committed atomically with its lifecycle event.
