# VideoOS Orchestrator

Durable execution/control-plane service.

Responsibilities:

- workflow state machines and dependency graphs;
- retries, backoff, timeout, cancellation and leases;
- idempotent dispatch to workers, publishers and AI steps;
- local/cloud execution routing by declared capabilities;
- human approval/checkpoint state;
- recovery and reconciliation after partial failure.

AI may propose plans or decisions, but deterministic orchestration owns state transitions, permissions, limits and side-effect execution.
