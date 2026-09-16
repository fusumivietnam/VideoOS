---
id: decision-1
title: Keep project truth in repository state
date: '2026-09-16'
status: accepted
---

## Context

VideoOS is developed with coding agents across multiple sessions and tools. Long-lived project context held only in a chat thread is fragile: a fresh session may not know the active milestone, why an architectural choice was made, which task is blocked, or which generated knowledge is stale.

The project also benefits from code-intelligence tools such as Understand Anything, but generated graphs are derived from source/docs and can become stale or be rebuilt. Treating a generated graph or an agent-memory database as canonical would create competing sources of truth.

## Decision

VideoOS engineering truth is repository-owned and versioned:

1. Git source/history is implementation truth.
2. `docs/roadmap.md` defines milestone intent and exit conditions.
3. `backlog/tasks/` owns actionable work, status, dependencies, and acceptance criteria.
4. `backlog/decisions/` records architectural/product engineering decisions and supersession.
5. Larger cross-service features may use spec-driven documents with explicit acceptance/migration criteria.
6. `.project/state.json` is a small machine-readable current-state snapshot and must point back to canonical files.
7. Understand Anything `.ua` output is a rebuildable read model for code/knowledge navigation, semantic search, and impact analysis. It is never authoritative over source, tasks, decisions, or specs.
8. Chat memory is working context only and must not be required to resume the project.

Understand Anything is installed as developer tooling in Codex/Claude environments. It is not a VideoOS runtime dependency and does not run in normal GitHub Actions during M2.K.

## Consequences

### Positive

- Fresh agents can resume work from repository state without historical conversations.
- Decisions and task dependencies are reviewable through normal Git history/PRs.
- Generated project intelligence can be replaced or rebuilt without migrating core state.
- VideoOS keeps the ponytail core deterministic and dependency-light.

### Negative

- Roadmap/task/state files must be updated as part of delivery hygiene.
- Generated knowledge may temporarily lag source changes until a developer refreshes it.
- Some information previously implicit in conversations must be written down explicitly.

## Operational rule

When repository state and chat context disagree, verify Git/current files and update the repository record. Do not silently preserve the chat version as truth.
