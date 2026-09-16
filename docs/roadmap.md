# VideoOS roadmap

Current status: 2026-09-16

This roadmap keeps the ponytail core small while turning the architecture into an executable, observable media control plane. Each milestone should leave the repository runnable and should avoid adding infrastructure or GitHub Actions workflows before a real execution path needs them.

## Delivery policy

- Keep one primary CI workflow for architecture checks, typechecking, tests, and only path-gated durable integration.
- Keep OpenCodeReview manual-only while the product foundation is moving quickly.
- Prefer contract-compatible adapters over provider-specific logic in domain/services.
- Prefer local/free development paths first; managed services are substitutions behind ports.
- Add infrastructure only when a real execution path needs it.
- Every external side effect must be idempotent and observable.
- Git/docs/backlog/specs are canonical engineering state; chat context and generated knowledge graphs are caches/read models, not sources of truth.

## M0 — Executable foundation — complete

Delivered: pnpm/Node 24 monorepo, contract-first boundaries, architecture guard, core contracts, in-memory reference adapters, service skeletons, agent engineering instructions, and manual-only OpenCodeReview.

Exit condition met: architecture compiles and core module boundaries are enforceable.

## M1 — Executable vertical slice — complete

Delivered: idempotent queue/leasing, max-attempt protection, generic QueueRunner, API job status, local runtime composition, media/publish smoke tests, committed lockfile, frozen CI install and dependency caching.

Exit condition met: API -> queue -> runner -> worker/provider port -> lifecycle event executes end to end without external infrastructure.

## M2 — Durable local-first backbone — complete

Delivered:

- PostgreSQL membership, asset, job queue, outbox and publisher-idempotency adapters.
- `FOR UPDATE SKIP LOCKED`, retry/dead-letter semantics and final-lease protection.
- Transaction helper plus provider-neutral queue settlement boundary.
- Atomic terminal queue settlement + lifecycle outbox append.
- Advisory-locked migration runner and PostgreSQL 18-compatible local Compose.
- Filesystem object store and S3-compatible adapter with signed reads.
- Path-gated PostgreSQL integration inside the single CI quality job.
- Durable runtime liveness/readiness plus backup/restore guidance.

Reliability note: lease acquisition and informational execution-start events remain separate; correctness-critical terminal queue state and lifecycle outbox state are atomic.

Exit condition met: queued work and terminal workflow metadata are restart-safe, object/control-plane recovery is documented, and provider selection stays behind stable ports.

## M2.K — Engineering project brain — active

Delivered:

- [x] Backlog-compatible task records and durable decision records.
- [x] `.project/state.json` machine-readable current-state snapshot.
- [x] `AGENTS.md` discovery path for fresh sessions.
- [x] Local Understand Anything usage documented without runtime/CI dependency.
- [x] `.ua` scratch ignored while reviewed shareable artifacts may be committed.
- [ ] Bootstrap/review the initial `.ua` graph locally in a supported developer environment (`VID-5`).

Canonical truth remains Git source/history, backlog tasks, decision records, selective specs and `.project/state.json`. Understand Anything remains rebuildable derived intelligence only.

## M3 — Media production path — complete

Delivered:

- [x] `VID-6`: sandboxed FFmpeg executor with typed argument construction, path confinement, bounded stderr/time/output, deterministic naming and normalized failures.
- [x] `VID-7`: ffprobe normalization, derived-asset persistence, checksum metadata, source/job/transform/executor lineage and reproducible manifests.
- [x] `VID-8`: deterministic vertical/landscape/square media presets and project-scoped subtitle staging/burn-in with preset-aware lineage.
- [x] `VID-9`: optional local-node media execution with generic CPU/GPU requirements, lease/result dedupe semantics and QueueRunner-authoritative retry/dead-letter behavior.
- [x] `VID-10`: deterministic JPEG/PNG thumbnail/representative-frame extraction with explicit 1000 ms default, frame-aware identity and image-asset lineage.
- [x] Local and local-node execution share the same media executor/finalizer boundaries and object-store/asset semantics.

Exit condition met: source asset -> deterministic derived video/image asset works locally and through a worker node with reproducible metadata/lineage.

## M4 — Multi-network publishing — active

Goal: publish the same canonical content package through independent network adapters.

- [x] `VID-11`: first production adapter implemented for YouTube with a capability matrix, trusted object-store asset loading, resumable upload, server-side credential boundary, durable attempt journal, normalized receipts, retry/rate-limit translation and exact reconciliation.
- [ ] `VID-12`: add refresh-capable YouTube OAuth onboarding, credential rotation/disconnect and an explicit manual live-provider smoke path.
- [x] First-adapter provider logic stays outside publisher core and uses the same queue retry/max-attempt authority.
- [x] First-adapter automated tests use fake transports; live provider credentials are not a CI dependency.
- [ ] Manual approval/scheduling policies before autonomous bulk publishing.
- [ ] Add a second network adapter only after the first live YouTube path is verified or explicitly waived by a recorded decision.

Exit condition: at least two network adapters use the same publisher core without forks and their credential/reconciliation paths are operationally verified.

## M5 — Observability and flywheel

Goal: make real usage data improve product decisions and automation quality.

- Append-only workflow/product events with stable names/versions.
- Correlation across project, job, asset, publish attempt, provider and local node.
- Operational views for queue/retry/dead-letter, transform duration, publish success/failure and provider latency/cost.
- Product views for feature use, completion, abandonment and repeated manual corrections.
- AI summaries/recommendations may consume observed data but do not mutate durable state directly.

Exit condition: the system can explain where time/cost/failures occur and recommend what to improve next.

## M6 — Product RAG, MCP, and agent layer

Goal: expose useful runtime/product context and bounded tools without turning the deterministic core into an agent framework.

- RAG indexes approved architecture/contracts/capabilities/runbooks/event summaries/project knowledge as a read-side service.
- Add evaluation sets before autonomous retrieval-driven decisions.
- MCP exposes small authorized tools such as project lookup, job status, asset search, publish preview and analytics only after underlying APIs stabilize.
- MCP/RAG never bypass authorization, transactional truth or queue/workflow invariants.

Exit condition: agents can retrieve context and invoke bounded tools without bypassing deterministic system boundaries.

## M7 — Product surface, deployment, and scale

- Web control plane for projects, assets, workflows, schedules, jobs, approvals, analytics and adapter connections.
- Environment promotion/release process.
- GHCR/GitHub Packages only when deployable artifacts exist; Pages only for docs/status/static material when useful.
- Deployment adapters for selected hosting targets.
- Horizontal scaling, partitioning, rate-limit coordination and tenant quotas only when metrics justify them.
- Security review, audit trails, secret rotation, retention and incident runbooks.

Exit condition: the platform can be operated and upgraded without coupling product logic to one deployment vendor.

## Immediate execution order

1. Complete `VID-12`: server-side YouTube OAuth refresh/onboarding plus an explicit manual private-upload/reconciliation smoke test.
2. Record live-provider results and operational constraints; do not place OAuth secrets in CI.
3. Add manual approval/scheduling policy before autonomous or bulk publishing.
4. Add a second network adapter only after the YouTube live path is verified or a waiver is recorded.
5. Bootstrap/review the initial Understand Anything `.ua` graph locally when a supported developer environment is available (`VID-5`); do not block runtime work on this manual step.
6. Add event-based operational views before expanding product RAG/MCP automation.

Do not start broad product RAG/MCP automation or many provider integrations before deterministic publishing behavior is trustworthy. Engineering Project Brain work may continue in parallel because it is developer tooling and derived repository intelligence, not a runtime dependency.
