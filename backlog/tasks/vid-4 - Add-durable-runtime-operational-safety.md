---
id: VID-4
title: Add durable runtime operational safety
status: To Do
assignee: []
created_date: '2026-09-16 21:18'
labels: [m2, operations, durability]
dependencies:
  - VID-2
documentation:
  - docs/roadmap.md
  - packages/adapters/persistence-postgres/README.md
priority: medium
type: enhancement
ordinal: 4000
---

## Description

Close the operational portion of M2 by documenting backup/restore and exposing durable-runtime health/readiness signals that distinguish process liveness from dependency readiness.

The implementation must remain provider-neutral at service boundaries and should not introduce an observability platform before basic health semantics are proven.

## Acceptance Criteria
- [ ] #1 Durable runtime exposes a lightweight liveness signal.
- [ ] #2 Readiness verifies required durable dependencies without leaking credentials or internal provider errors.
- [ ] #3 PostgreSQL migration state is covered by operational documentation or readiness behavior.
- [ ] #4 Backup and restore procedures are documented for the selected local-first database/object-storage setup.
- [ ] #5 Recovery notes cover queued work, outbox records, and object metadata consistency.
- [ ] #6 M2 exit condition is re-evaluated after these checks and the targeted integration gate pass.
