# VideoOS roadmap

Current status: 2026-09-16

This roadmap keeps the ponytail core small while turning the architecture into an executable, observable media control plane. Each milestone should leave the repository runnable and should avoid adding infrastructure or GitHub Actions workflows before a real execution path needs them.

## Delivery policy

- Keep one primary CI workflow for architecture checks, typechecking, and tests.
- Keep OpenCodeReview manual-only while the product foundation is still moving quickly.
- Prefer contract-compatible adapters over provider-specific logic in domain/services.
- Prefer local/free development paths first; managed services are substitutions behind ports.
- Add infrastructure only when a real execution path needs it.
- Every external side effect must be idempotent and observable.
- Git/docs/backlog/specs are canonical engineering state; chat context and generated knowledge graphs are caches/read models, not sources of truth.

## M0 — Executable foundation — complete

Delivered:

- pnpm monorepo on Node.js 24.
- Contract-first package boundaries and architecture guard.
- Core contracts for jobs, events, publishing, media, AI, analytics, and local nodes.
- In-memory reference implementations for identity, storage, job queue, event bus/outbox.
- API facade, orchestrator, media worker, publisher, analytics, and AI gateway service skeletons.
- Agent engineering instructions and reusable skills for adding services/adapters and release review.
- OpenCodeReview integration retained but paused/manual-only.

Exit condition met: architecture compiles and core module boundaries are enforceable.

## M1 — Executable vertical slice — complete

Goal: make `API -> queue -> runner -> worker/provider port -> event` executable with deterministic retry behavior and tests before introducing durable infrastructure.

Delivered:

- [x] Queue idempotency and leasing reference implementation.
- [x] Queue job inspection for operational/job-status use cases.
- [x] Prevent lease recovery from exceeding `maxAttempts`; exhausted jobs go to dead letter.
- [x] Generic orchestrator queue runner with lifecycle events, retries, and dead-letter result.
- [x] Dependency-light tests that run through the existing single CI workflow.
- [x] API job-status query with project authorization and a minimal non-sensitive status projection.
- [x] Application composition root wiring API, queue runner, and in-memory adapters into a runnable local runtime.
- [x] End-to-end smoke scenario for one media job and one publish job using fake provider/executor adapters.
- [x] Committed `pnpm-lock.yaml`, frozen-lockfile CI install, and pnpm dependency caching.

Exit condition met: commands enter through the API facade, execute through queue-backed runners, emit lifecycle events, and are asserted end-to-end without external infrastructure.

## M2 — Durable local-first backbone — active

Goal: replace only the persistence points required by the M1 vertical slice while preserving public contracts and restart safety.

Progress:

- [x] PostgreSQL-backed membership, asset, job queue, and transactional outbox adapters.
- [x] Durable queue leasing with `FOR UPDATE SKIP LOCKED`, inspection, retry/dead-letter semantics, and final-lease exhaustion protection.
- [x] Transaction helper so durable state and outbox writes can share one PostgreSQL transaction.
- [x] Advisory-locked SQL migration runner and local PostgreSQL Docker Compose bootstrap with healthcheck.
- [x] Durable adapters wired through an application composition root behind the same provider-neutral ports.
- [x] Durable publisher idempotency storage.
- [x] Provider-neutral queue settlement boundary.
- [x] PostgreSQL terminal queue settlement (`complete`/`fail`) + lifecycle outbox append in one transaction, with rollback coverage.
- [ ] Add an S3-compatible object-store adapter, with local filesystem/MinIO for development and a cloud-compatible backend for deployment.
- [ ] Add targeted PostgreSQL integration gating once the durable runtime path is stable, without starting a database on unrelated PRs.
- [ ] Add backup/restore notes and operational health/readiness endpoints for the durable runtime.

Reliability note: lease acquisition and the informational `job.execution.started` event are separate. A crash after lease acquisition is handled through lease expiry/retry; correctness-critical terminal queue state is committed atomically with its lifecycle outbox event.

Exit condition: restart-safe execution with no loss of queued work or terminal workflow metadata.

## M2.K — Engineering project brain — active

Goal: remove long-term project state from chat memory without making RAG/agent infrastructure a runtime dependency.

Progress:

- [x] Add Backlog.md-compatible filesystem configuration and task records.
- [x] Add repository-owned decision records for durable engineering choices.
- [x] Add `.project/state.json` as a machine-readable current-state snapshot.
- [x] Make `AGENTS.md` direct fresh sessions through state, roadmap, tasks, decisions, architecture, and derived knowledge.
- [x] Document local Understand Anything usage for Claude Code and Codex without adding runtime/CI dependencies.
- [x] Ignore local `.ua` scratch while allowing reviewed shareable graph/config artifacts to be committed.
- [ ] Bootstrap and review the initial `.ua` graph locally in a supported developer environment.

Canonical engineering state:

- Git source/history for implementation truth.
- Backlog task/dependency records for roadmap execution.
- Decision records for architectural choices and supersession.
- Spec Kit-style feature specs selectively for larger cross-service changes.
- `.project/state.json` for a small current-state snapshot that points back to canonical files.

Derived intelligence:

- Understand Anything is a local Codex/Claude developer skill/plugin, not a VideoOS runtime package.
- `.ua` code/knowledge graph artifacts may support codebase navigation, semantic search, domain understanding, and change-impact analysis.
- `.ua` is rebuildable derived state and never overrides Git/backlog/decision/spec truth.
- No dedicated GitHub Actions workflow is added for Understand Anything during this phase.

Later boundary:

- Add a provider-neutral `ProjectKnowledgePort` only when multiple project-knowledge consumers/adapters justify it.
- Candidate adapters later: Understand Anything read model, Git/backlog read models, pgvector corpus retrieval, and Graphiti temporal knowledge.
- MCP exposure belongs at the bounded tool layer, not in the deterministic job engine.

Exit condition: a fresh coding-agent session can discover current milestone, blockers, decisions, and code relationships from repository state without requiring historical chat context.

## M3 — Media production path

Goal: turn the media worker into a safe, repeatable production pipeline.

- FFmpeg executor adapter with strict argument construction, path sandboxing, time/resource limits, and deterministic output naming.
- Probe/metadata extraction and normalized asset metadata.
- Derived-asset lineage and project-scoped object keys.
- Thumbnail, subtitle, audio normalization, resize/crop, and format presets.
- Local-node execution as an optional adapter for GPU/heavy workloads.
- Reproducible execution manifests so the same transform can be replayed.

Exit condition: source asset -> deterministic derived asset works locally and through a worker node.

## M4 — Multi-network publishing

Goal: publish the same canonical content package through independent network adapters.

- Canonical publish validation and platform capability matrix.
- Credential vault boundary; credentials never enter browser/public contracts.
- Adapter contract for upload, post creation, scheduling, polling, retry, and rate-limit translation.
- Start with one platform adapter, prove idempotency/recovery, then add the next platform.
- Publish receipts and reconciliation jobs for remote-state drift.
- Manual approval/scheduling policies before autonomous bulk publishing.

Exit condition: at least two network adapters use the same publisher core without forks.

## M5 — Observability and flywheel

Goal: make real usage data improve product decisions and automation quality.

- Append-only workflow/product events with stable event names and versions.
- Correlation across project, job, asset, publish attempt, provider, and local node.
- Operational views: queue depth, retry/dead-letter rate, transform duration, publish success/failure, provider latency/cost.
- Product views: feature use, workflow completion, abandonment, repeated manual corrections.
- AI summaries and recommendations consume observed data but do not mutate durable state directly.
- Build the optimization flywheel only from measured bottlenecks and accepted user corrections.

Exit condition: the system can explain where time/cost/failures occur and recommend what to improve next.

## M6 — Product RAG, MCP, and agent layer

Goal: expose useful runtime/product context and bounded tools to assistants without turning the core into an agent framework.

RAG:

- Index architecture docs, contracts, adapter capabilities, operational runbooks, workflow/event summaries, and approved project knowledge.
- Keep retrieval as a read-side service; durable truth remains in transactional stores.
- Add evaluation sets before using retrieval for autonomous decisions.

MCP:

- Use MCP at the tool/integration boundary for developer tooling and optional end-user tool access.
- Do not make MCP a dependency of the deterministic job engine.
- Expose small capabilities such as project lookup, job status, asset search, publish preview, and analytics queries after their underlying APIs are stable.

Exit condition: agents can retrieve project/system context and invoke bounded tools without bypassing authorization or workflow invariants.

## M7 — Product surface, deployment, and scale

- Web control plane for projects, assets, workflows, schedules, jobs, approvals, analytics, and adapter connections.
- Environment promotion and release process.
- GitHub Packages/container registry only when deployable artifacts exist; avoid publishing every internal workspace package prematurely.
- GitHub Pages only for documentation/status/static product material when useful, not as an application runtime.
- Deployment adapters for the selected hosting target.
- Horizontal worker scaling, queue partitioning, rate-limit coordination, and tenant quotas when metrics demonstrate the need.
- Security review, audit trails, secret rotation, data retention, and incident runbooks.

Exit condition: the platform can be operated and upgraded without coupling product logic to a specific deployment vendor.

## Immediate execution order

1. Bootstrap/review the initial Understand Anything `.ua` graph locally when a supported developer environment is available; do not block runtime work on this manual step.
2. Add the first S3-compatible object-store adapter, local-first (`VID-2`).
3. Add a targeted PostgreSQL integration gate inside the existing CI workflow without database cost on unrelated PRs (`VID-3`).
4. Add durable runtime health/readiness plus backup/restore notes and close M2 (`VID-4`).
5. Add the first real media executor (FFmpeg) with strict sandbox/resource limits.
6. Add the first real publishing adapter and prove idempotent reconciliation.
7. Add event-based operational views before expanding product RAG/MCP automation.

Do not start broad product RAG/MCP automation or many provider integrations before the durable execution/event path is trustworthy. Engineering Project Brain work is allowed earlier because it is developer tooling and derived repository intelligence, not a dependency of the runtime core.
