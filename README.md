# VideoOS

VideoOS is a modular control plane for creating, orchestrating, publishing, observing, and improving media workflows across multiple networks.

## Architecture principles

- **Ponytail core**: keep the core small, stable, deterministic, and dependency-light.
- **Adapters over forks**: external editors, publishers, AI providers, storage backends, and agents integrate through contracts/adapters.
- **Deterministic pipeline + agent**: correctness-critical steps are code-driven; AI is used for dynamic reasoning, retrieval, review, and suggestions.
- **Event-first observability**: every meaningful workflow step emits structured events for analytics, replay, optimization, and AI summaries.
- **Local + cloud execution**: workloads can run in web/cloud services or trusted local worker nodes.
- **Contract-first evolution**: cross-service schemas are versioned and backward-compatible.

## Project navigation

- `docs/architecture/system.md` — system map and boundaries.
- `docs/architecture/mvp-flow.md` — canonical command/media/publish/local-node execution paths.
- `docs/roadmap.md` — current delivery status and milestone sequence.
- `docs/quality/open-code-review.md` — optional AI code-review integration; currently paused/manual-only.
- `AGENTS.md` and `.agents/skills/` — repository instructions and reusable engineering skills.
