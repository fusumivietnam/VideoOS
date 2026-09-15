# VideoOS Module Boundaries

This document turns the system architecture into implementation ownership boundaries. Each module owns its data and exposes contracts; direct cross-service database access is forbidden.

## Apps

### `apps/web`
User-facing control plane for projects, assets, workflows, publishing, analytics and administration.

### `apps/desktop`
Optional desktop shell for local files, editor bridges and trusted local execution. It communicates with the control plane through versioned APIs/contracts and never becomes the system of record.

## Services

### `services/api`
- authentication/authorization enforcement;
- tenant/workspace APIs;
- input validation and contract translation;
- no long-running workflow execution in request handlers.

### `services/orchestrator`
- durable workflow state;
- dependency graphs;
- retries/backoff/timeouts/cancellation;
- idempotency and execution leases;
- dispatch to local/cloud workers and AI steps.

### `services/publisher`
- scheduling and publishing side effects;
- connection/token references;
- platform capability registry;
- rate limits and retry classification;
- remote status reconciliation;
- publisher adapters are isolated from canonical domain logic.

### `services/media-worker`
- ffprobe/probe operations;
- transcode/render/thumbnail/waveform/media transforms;
- sandboxed handling of untrusted media;
- local/GPU/cloud worker capability reporting.

### `services/ai-gateway`
- model/provider registry;
- OpenAI/Anthropic/local provider adapters;
- structured output validation;
- tool/MCP authorization;
- prompt/version registry;
- token/cost/rate controls and telemetry.

### `services/analytics`
- event ingestion;
- aggregations and derived metrics;
- content/network performance normalization;
- product and engineering flywheel datasets.

## Shared packages

### `packages/contracts`
Versioned cross-boundary schemas. This package should have minimal runtime dependencies.

### `packages/domain`
Pure business rules and state transitions that do not depend on frameworks, databases, queues or providers.

### `packages/events`
Event envelope, catalog, versioning conventions and event validation.

### `packages/adapters`
Interfaces and utilities for editor, publisher, storage, AI and worker adapters.

### `packages/sdk`
Typed clients for APIs/events intended for first-party apps and future external integrators.

### `packages/observability`
Logging, tracing, metric names, correlation context and redaction conventions.

### `packages/config`
Typed environment/config loading and validation. Secret values are referenced, not propagated in domain objects.

### `packages/testing`
Contract-test harnesses, fixtures, fake providers, deterministic clocks and idempotency/retry test utilities.

## Adapter families

### Editor adapters
Canonical editor-neutral project model first; converters/bridges second. Never let a CapCut/Resolve/Premiere/FCP-specific schema become the canonical project model.

### Publisher adapters
Every network implements the same capability-oriented interface. Unsupported features are declared through capabilities instead of branching throughout core code.

### Worker adapters
Workers advertise capabilities (CPU/GPU/codecs/local paths/editor availability) and orchestrator scheduling chooses the correct executor.

### AI adapters
All providers return validated canonical model/tool results. Provider SDK objects never escape the AI gateway.

## Cross-cutting invariants

- no service imports another service implementation;
- no service reads another service database directly;
- every external side effect uses idempotency keys;
- events are versioned and append-only;
- all network/model/editor peculiarities live behind adapters;
- sensitive values are stored through secret references;
- every asynchronous operation carries correlation IDs;
- all high-value workflows are observable and replay/repair aware.
