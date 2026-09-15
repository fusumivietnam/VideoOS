# VideoOS

VideoOS is a modular control plane for creating, orchestrating, publishing, observing, and improving media workflows across multiple networks.

## Architecture principles

- **Ponytail core**: keep the core small, stable, deterministic, and dependency-light.
- **Adapters over forks**: external editors, publishers, AI providers, storage backends, and agents integrate through contracts/adapters.
- **Deterministic pipeline + agent**: correctness-critical steps are code-driven; AI is used for dynamic reasoning, retrieval, review, and suggestions.
- **Event-first observability**: every meaningful workflow step emits structured events for analytics, replay, optimization, and AI summaries.
- **Local + cloud execution**: workloads can run in web/cloud services or trusted local worker nodes.
- **Contract-first evolution**: cross-service schemas are versioned and backward-compatible.

See `docs/architecture/system.md` for the system map and `docs/quality/open-code-review.md` for the AI code-review integration.
