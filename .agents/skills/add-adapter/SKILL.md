# Add Adapter

Use this workflow for a new social network, model provider, storage backend, editor bridge or infrastructure provider.

1. Run `pnpm generate:adapter -- <kind> <name>`.
2. Keep provider SDK types, credentials and raw errors inside the adapter package.
3. Translate canonical VideoOS inputs to provider inputs and normalize outputs/errors back to VideoOS contracts.
4. Declare capability differences explicitly instead of branching provider logic in core services.
5. Make write operations idempotent and classify retryable vs permanent failures.
6. Add contract tests and fixtures without real secrets.
7. Run `pnpm architecture:check`, `pnpm typecheck`, and `pnpm test`.
