# Architecture Review

Use this workflow before merging changes that affect boundaries, durable state, side effects or shared contracts.

Review in this order:

1. Contract compatibility and project scoping.
2. Authorization and credential isolation.
3. Deterministic state transitions, leases, retries and idempotency.
4. Service isolation: no service-to-service implementation imports.
5. Provider isolation: no provider SDK types in public contracts.
6. Event/outbox consistency and at-least-once safety.
7. Local-node trust boundary and task lease semantics where applicable.
8. Observability, recovery and rollback implications.

Finish by running `pnpm architecture:check`, `pnpm typecheck`, and `pnpm test`. Report concrete violations and proposed changes; do not replace deterministic checks with subjective AI approval.
