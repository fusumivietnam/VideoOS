# VideoOS MVP execution flow

## Command path

1. A user/service principal calls the API facade with a project-scoped command.
2. The API authorizes a capability through `@videoos/identity`.
3. Resource ownership is validated against project-scoped repositories.
4. The API enqueues a durable command in `@videoos/job-queue` and returns a job id.
5. The orchestrator owns deterministic job state transitions.
6. A worker leases the job, executes through a provider-neutral port, and reports success/failure.
7. Domain events are published through `@videoos/event-fabric`; production adapters should use the transactional outbox to avoid dual-write loss.
8. Analytics consumes append-only events and never becomes the transactional source of truth.

## Publish path

`API -> queue(publish) -> orchestrator -> publisher -> network adapter -> remote platform`

The publisher owns idempotency and fan-out. Network-specific SDKs, credentials, rate-limit behavior and error translation belong in adapters only.

## Media path

`API -> queue(media) -> media-worker -> executor -> object store -> asset repository`

The media worker creates a deterministic execution plan. FFmpeg/GPU/process invocation belongs behind an executor boundary and must enforce resource/time/path limits.

## Local node path

`Cloud scheduler -> node task lease -> local node -> media/AI/editor executor -> task result`

Node tasks are project scoped. A node may execute only declared capabilities and only while a lease is valid. Production transport must authenticate nodes, prevent replay, rotate credentials and bind every task/result to node + project + lease ids.

## AI path

`orchestrator -> ai-gateway -> provider adapter or local-node AI capability`

The AI gateway is not allowed to mutate durable workflow state directly. It returns structured recommendations/results; deterministic application code validates and applies them.

## Infrastructure substitutions

The current in-memory implementations are development/test references only. Replace them behind the same interfaces:

- EventBus / EventOutbox: NATS, Kafka, Redis Streams, Postgres outbox, etc.
- JobQueue: Redis/BullMQ, Postgres queue, NATS JetStream, cloud queue, etc.
- ObjectStore: S3-compatible, R2, MinIO, local disk adapter.
- MembershipRepository: Postgres or auth-provider-backed projection.

No domain or service code should depend on these concrete providers.

## Reliability invariants

- External side effects require idempotency.
- Queue delivery is assumed to be at least once.
- Lease expiry permits another worker to recover abandoned work.
- Events must be replay-safe and project scoped.
- Durable state changes and outbox insertion should share a transaction in production.
- Authorization is server-side and deny-by-default.
- Provider credentials never cross into public contracts or browser state.
