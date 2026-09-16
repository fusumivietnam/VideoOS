# Release Check

Use this workflow for release readiness.

1. Run `pnpm quality`.
2. Confirm migrations/contracts are backward compatible or versioned.
3. Confirm secrets are externalized and least-privilege permissions are used.
4. Confirm external writes are idempotent and retry-safe.
5. Verify dead-letter/recovery paths for queued work.
6. Verify observability for API, orchestrator, publisher, media worker, AI gateway and local nodes.
7. Confirm rollback path and compatibility with the previous deployed version.
8. Summarize known risks and any intentionally deferred work.
