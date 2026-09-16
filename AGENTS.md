# VideoOS Engineering Guide

This repository is designed for agent-assisted development with deterministic safeguards.

## Architecture invariants

1. `packages/*` contains reusable contracts, ports and deterministic primitives. Packages must not depend on `services/*` or `apps/*`.
2. `services/*` are independently replaceable runtime units. A service must not import another service implementation directly; communicate through `@videoos/*` contracts, queues or events.
3. External providers belong behind adapters. Provider SDK types must not leak into public contracts.
4. Durable state transitions, authorization, retries, leases, idempotency and side effects are deterministic. AI may propose decisions but must not bypass these boundaries.
5. Every resource, task and event is project scoped unless explicitly documented otherwise.
6. External side effects must be idempotent and safe under at-least-once delivery.
7. Git/docs/backlog/specs are canonical engineering state. Chat context and generated knowledge graphs are working/derived context only.

## Before changing code

For every fresh session:

1. Read `.project/state.json` for the current milestone, focus, blockers, and next task IDs.
2. Read `docs/roadmap.md` and the relevant task(s) under `backlog/tasks/`.
3. Read relevant decisions under `backlog/decisions/` before changing architecture or delivery policy.
4. Read `docs/architecture/system.md`, `docs/architecture/modules.md` and `docs/architecture/mvp-flow.md` for cross-cutting changes.
5. Use `.ua/` / Understand Anything when available for navigation and impact analysis, but verify conclusions against canonical source/docs.
6. Reuse existing contracts before introducing a new abstraction.
7. Prefer a new adapter over adding provider-specific branches to core code.

Do not rely on historical chat context as the only record of a task, blocker, or decision. If new long-lived information affects future work, update the appropriate repository state in the same delivery batch.

## Required checks

Run:

```bash
pnpm architecture:check
pnpm typecheck
pnpm test
```

## Common workflows

- New service: follow `.agents/skills/add-service/SKILL.md` or run `pnpm generate:service -- <name>`.
- New provider/network adapter: follow `.agents/skills/add-adapter/SKILL.md` or run `pnpm generate:adapter -- <kind> <name>`.
- Architecture review: follow `.agents/skills/architecture-review/SKILL.md`.
- Release readiness: follow `.agents/skills/release-check/SKILL.md`.
- Project knowledge and local Understand Anything usage: read `docs/engineering/project-knowledge.md`.

## Project Brain boundaries

- `backlog/tasks/` owns actionable engineering work and acceptance criteria.
- `backlog/decisions/` owns durable engineering decisions and rationale.
- `.project/state.json` is a small current-state snapshot; keep it aligned with canonical tasks/roadmap.
- `.ua/` is rebuildable derived intelligence. Never let it override source, tasks, decisions, or specs.
- Do not add Understand Anything, Graphiti, Mem0, or similar tools to deterministic runtime dependencies solely for developer memory.

## OpenCodeReview

OpenCodeReview is intentionally paused. Its configuration is retained for future reactivation, but it is not part of the normal CI or development path.
