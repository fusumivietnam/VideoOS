# Add Service

Use this workflow when introducing a new runtime service.

1. Confirm the capability cannot live in an existing service or reusable package.
2. Run `pnpm generate:service -- <name>`.
3. Define/reuse canonical contracts before implementing transport/provider details.
4. Do not import another service implementation. Use contracts, events or queues.
5. Put external SDKs behind adapters.
6. Add tests for state transitions, retries, idempotency and authorization where relevant.
7. Run `pnpm architecture:check`, `pnpm typecheck`, and `pnpm test`.
8. Update architecture docs only when a boundary or ownership rule changes.
