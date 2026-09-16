# VideoOS System Architecture

## 1. Core idea

VideoOS is a control plane for media operations. The system separates deterministic orchestration from AI reasoning so that scale, correctness, observability, and editor interoperability are preserved over time.

## 2. Ponytail architecture

The system is organized around a deliberately small core with replaceable adapters around it.

### Core domains

1. **Identity & tenancy**
   - users, teams, workspaces, roles, permissions
   - account/channel ownership and secrets references

2. **Project & asset graph**
   - projects, sources, assets, versions, derivatives
   - timelines, sequences, captions, audio, thumbnails, metadata
   - editor-neutral project manifest

3. **Workflow orchestration**
   - durable jobs, queues, retries, idempotency, dependency graph
   - state machines and human-in-the-loop checkpoints
   - local/cloud execution routing

4. **Publishing control plane**
   - normalized publish request
   - platform-specific adapters
   - scheduling, retries, rate limits, policy checks, status reconciliation

5. **Analytics & event fabric**
   - append-only product/workflow events
   - publish outcomes and content performance
   - cost, latency, failure, quality, and usage signals

6. **AI/agent plane**
   - provider-independent model gateway
   - tools, MCP/connector adapters, skills, prompts, evaluators
   - recommendation, summarization, planning, QA and remediation agents

7. **Policy & quality plane**
   - schemas, invariants, compatibility policy
   - static analysis, tests, OpenCodeReview and security gates

### Replaceable adapters

- Editors: CapCut-style projects, DaVinci Resolve, Premiere Pro, Final Cut Pro, OpenCut and future editors.
- Publishers: YouTube, TikTok, Meta/Facebook/Instagram, X and future networks.
- AI providers: OpenAI-compatible, Anthropic-compatible and local models.
- Storage: local filesystem, S3-compatible/object storage and future backends.
- Workers: cloud workers, desktop/local nodes, GPU nodes and specialized render/transcode nodes.

## 3. Repository layout

```text
apps/
  web/                  # user-facing control plane UI
  desktop/              # optional local/desktop shell
services/
  api/                  # public/backend API
  orchestrator/         # durable workflow/state-machine engine
  publisher/            # publish scheduler + platform adapters
  media-worker/         # transcode/probe/render/media jobs
  ai-gateway/           # model/provider abstraction
  analytics/            # event ingestion + aggregation
packages/
  contracts/            # versioned schemas and shared types
  domain/               # pure domain logic
  events/               # event envelope + event catalog
  adapters/             # adapter interfaces/base utilities
  sdk/                  # internal/public client SDK
  observability/        # logging/tracing/metrics conventions
  config/               # typed configuration
  testing/              # fixtures, contract tests, test harnesses
tooling/
  scripts/              # repo automation
  generators/           # code/service/template generation
infra/
  containers/           # container assets
  deploy/               # deployment manifests
  observability/        # dashboards/collectors
.opencodereview/
  rule.json             # repository-specific AI review policy
.github/
  workflows/            # CI, security and AI review
```

## 4. Contracts first

Cross-boundary data must be carried by explicit versioned contracts. Services must not import another service's implementation internals.

Required contract classes:

- `ProjectManifest`
- `AssetRef`
- `TimelineManifest`
- `WorkflowDefinition`
- `WorkflowRun`
- `JobEnvelope`
- `PublishRequest`
- `PublishResult`
- `ChannelConnection`
- `EventEnvelope`
- `MetricSnapshot`
- `AgentTask`
- `AgentResult`

Rules:

- schema evolution is backward-compatible by default;
- every external adapter translates to/from canonical contracts;
- IDs are stable and globally unique;
- retries must be idempotent;
- external side effects require idempotency keys;
- timestamps are UTC at rest;
- secrets never enter domain events or logs.

## 5. Workflow model

```text
Intent
  -> Plan
  -> Validate
  -> Resolve adapters/resources
  -> Execute deterministic steps
  -> AI step(s) where dynamic reasoning is useful
  -> Human checkpoint when policy requires
  -> Publish / export
  -> Reconcile remote state
  -> Emit events
  -> Measure outcome
  -> Recommend improvements
```

The deterministic pipeline owns file selection, job state, retry policy, concurrency, limits, permissions, schema validation and side-effect execution. Agents may reason, retrieve context, score options and propose actions, but they do not bypass core invariants.

## 6. Flywheel

```text
Create -> Edit -> QA -> Publish -> Observe -> Learn -> Recommend -> Create
```

The event fabric records inputs, decisions, execution metrics, outcomes and user corrections. AI recommendations are evaluated against later outcomes so prompts, workflows and defaults can improve from actual product usage rather than intuition.

## 7. Observability requirements

Every service emits:

- structured logs with correlation/run IDs;
- OpenTelemetry traces;
- latency, throughput, error and retry metrics;
- cost/token/GPU usage where applicable;
- domain events for business outcomes.

No feature is considered production-ready unless it is observable and its failure mode can be diagnosed without reproducing locally.

## 8. Quality gates

Pull requests must pass, as applicable:

1. formatting/linting;
2. type checking;
3. unit tests;
4. contract/schema compatibility tests;
5. integration tests for changed adapters;
6. secret/security scans;
7. OpenCodeReview focused AI review;
8. human review for high-risk areas.

OpenCodeReview is advisory by default during bootstrap. It may become blocking only after false-positive rate and review latency are measured on VideoOS changes.

## 9. Dependency policy

Prefer maintained open-source components and thin wrappers. External repositories are treated as upstream dependencies or sources of design patterns, not copied wholesale into the core.

For every external component record:

- license;
- pinned version/revision;
- adapter boundary;
- upgrade procedure;
- fallback/replacement plan;
- telemetry/cost implications.

This keeps the VideoOS core independently evolvable while allowing rapid reuse of proven software.
