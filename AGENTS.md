# VideoOS Engineering Guide

This repository is designed for agent-assisted development with deterministic safeguards.

## Architecture invariants

1. `packages/*` contains reusable contracts, ports and deterministic primitives. Packages must not depend on `services/*` or `apps/*`.
2. `services/*` are independently replaceable runtime units. A service must not import another service implementation directly; communicate through `@videoos/*` contracts, queues or events.
3. External providers belong behind adapters. Provider SDK types must not leak into public contracts.
4. Durable state transitions, authorization, retries, leases, idempotency and side effects are deterministic. AI may propose decisions but must not bypass these boundaries.
5. Every resource, task and event is project scoped unless explicitly documented otherwise.
6. External side effects must be idempotent and safe under at-least-once delivery.

## Before changing code

- Read `docs/architecture/system.md`, `docs/architecture/modules.md` and `docs/architecture/mvp-flow.md` for cross-cutting changes.
- Reuse existing contracts before introducing a new abstraction.
- Prefer a new adapter over adding provider-specific branches to core code.

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

## OpenCodeReview

OpenCodeReview is intentionally paused. Its configuration is retained for future reactivation, but it is not part of the normal CI or development path.
