# Runtime composition

This app contains executable composition roots for the VideoOS vertical slice. Domain/services remain provider-neutral; concrete persistence and media-process integrations are selected here at the application edge.

## In-memory runtime

`createInMemoryRuntime(...)` wires the API facade, in-memory identity/storage/queue/event adapters, deterministic queue runner, media worker, and publisher service.

The smoke test proves both canonical paths:

- `API -> queue(media) -> QueueRunner -> MediaWorker -> MediaExecutor`
- `API -> queue(publish) -> QueueRunner -> PublisherService -> NetworkPublisherAdapter`

Both paths emit lifecycle events and are observable through the project-authorized job-status API. The media path also propagates internal `projectId`, `jobId`, and source object-key context to the executor without adding those execution details to the public media-transform request.

Run with:

```bash
pnpm --filter @videoos/local-runtime test
```

## FFmpeg executor

`FfmpegExecutor` is the first production media-process adapter behind `MediaExecutor`. It expects an FFmpeg binary to be available on the runtime host (`ffmpeg` by default; override `binary` when composing the executor).

The executor is intentionally application-edge code. It:

- invokes FFmpeg with `spawn(..., shell: false)` and never accepts arbitrary shell fragments;
- translates only typed media operations into arguments and allowlists output containers/codecs;
- requires project/job/source-object execution context and derives a deterministic output identity from that context plus the transform plan;
- canonicalizes the source path and rejects sources/symlinks that resolve outside one configured sandbox root;
- writes only beneath a deterministic sandbox work directory and refuses existing symlink/non-regular output targets;
- applies a process timeout, bounded stderr capture, and maximum output-file size;
- normalizes process/validation failures into bounded `FfmpegExecutionError` categories;
- currently supports trim, resize and audio normalization; subtitle burn-in remains disabled until subtitle assets can be staged safely.

Example composition:

```ts
import { FfmpegExecutor } from './src/ffmpeg-executor.js';

const mediaExecutor = new FfmpegExecutor({
  sandboxRoot: '.videoos/media-sandbox',
  timeoutMs: 15 * 60_000,
  maxOutputBytes: 4 * 1024 * 1024 * 1024,
});
```

The first executor returns a local `file:` URI for its sandboxed output. VID-7 adds probing, normalized metadata, persisted derived-asset lineage and the staging/persistence step that moves deterministic outputs through the configured object-store boundary.

## Local filesystem object storage

`FileSystemObjectStore` is the zero-managed-service development implementation of the existing `ObjectStore` contract. It lives at the application edge and requires no provider SDK.

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

The local filesystem adapter deliberately does **not** return `file://` paths as signed URLs. `signedReadUrl(...)` fails explicitly. Provider-backed S3-compatible storage is available through `@videoos/adapter-storage-s3` for deployment paths that need signed read URLs.

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
