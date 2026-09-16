# Contributing to VideoOS

VideoOS uses a small deterministic core with provider-specific behavior behind contracts and adapters. Changes should preserve those boundaries rather than introducing cross-service implementation coupling.

## Local prerequisites

- Node.js 24 or newer
- pnpm 10.17.x

Install dependencies with `pnpm install`.

## Before opening a pull request

Run:

```bash
pnpm architecture:check
pnpm typecheck
pnpm test
```

Use a focused branch and keep one PR centered on one outcome. If a feature changes a cross-service contract, persistence model, authorization boundary, or deployment architecture, start with an Architecture / RFC issue or an explicit spec.

## Engineering rules

- Keep the ponytail core dependency-light and deterministic.
- Prefer adapters over forks and provider-specific branches in core services.
- Keep AI/RAG/MCP on bounded tool/read-side interfaces; they must not bypass workflow invariants.
- Emit structured events for meaningful workflow changes.
- Treat queue delivery as at-least-once and make external side effects idempotent.
- Never commit secrets, production tokens, or private user data.
- Add infrastructure only when an executable path requires it and measured requirements justify it.

## GitHub Actions policy

Prefer extending the existing `CI / quality` job over adding new workflows. New scheduled or matrix jobs must justify their Actions quota and maintenance cost. OpenCodeReview remains manual-only until explicitly reactivated.
