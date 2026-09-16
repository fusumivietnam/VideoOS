---
id: VID-1
title: Establish canonical Project Brain state
status: Done
assignee: []
created_date: '2026-09-16 21:18'
labels: [m2k, project-brain]
dependencies: []
documentation:
  - docs/roadmap.md
  - AGENTS.md
priority: high
type: enhancement
ordinal: 1000
---

## Description

Move long-lived engineering context out of chat memory and into repository-owned, agent-readable state. The repository must expose current milestone/focus, actionable tasks, architectural decisions, and developer knowledge-tooling guidance without making any generated knowledge graph a source of truth.

Understand Anything is developer tooling only. It may generate `.ua` derived artifacts locally, but VideoOS runtime packages and the deterministic execution core must not depend on it.

## Acceptance Criteria
- [x] #1 `.project/state.json` identifies the current milestone, focus, completed capabilities, blockers, next tasks, and canonical source paths.
- [x] #2 Backlog.md-compatible configuration and task records exist under `backlog/`.
- [x] #3 The decision to keep canonical engineering state in Git/backlog/ADR/specs and derived code intelligence in `.ua` is recorded under `backlog/decisions/`.
- [x] #4 `AGENTS.md` directs fresh agents to project state, roadmap, tasks, decisions, and architecture before cross-cutting changes.
- [x] #5 Understand Anything installation/use is documented for Claude Code and Codex without adding it to runtime dependencies or GitHub Actions.
- [x] #6 Local scratch output from Understand Anything is ignored while shareable graph/config artifacts remain eligible for commit.
