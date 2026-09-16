---
id: VID-4
title: Add durable runtime operational safety
status: In Progress
assignee: []
created_date: '2026-09-16 21:18'
labels: [m2, operations, durability]
dependencies:
  - VID-2
documentation:
  - docs/roadmap.md
  - packages/adapters/persistence-postgres/README.md
  - docs/operations/backup-restore.md
priority: medium
type: enhancement
ordinal: 4000
---

## Description

Close the operational portion of M2 by documenting backup/restore and exposing durable-runtime health/readiness signals that distinguish process liveness from dependency readiness.

The PostgreSQL runtime now exposes process liveness independently from readiness. Readiness verifies database connectivity plus the required migration set and returns bounded operational status without leaking raw provider errors or credentials. The local-first PostgreSQL + filesystem object-store backup/restore procedure is documented.

VID-4 remains in progress until VID-2 phase B defines the S3-compatible deployment path and its provider-specific recovery guidance, after which the M2 exit condition can be re-evaluated in full.

## Acceptance Criteria
- [x] #1 Durable runtime exposes a lightweight liveness signal.
- [x] #2 Readiness verifies required durable dependencies without leaking credentials or internal provider errors.
- [x] #3 PostgreSQL migration state is covered by operational documentation or readiness behavior.
- [x] #4 Backup and restore procedures are documented for the selected local-first database/object-storage setup.
- [x] #5 Recovery notes cover queued work, outbox records, and object metadata consistency.
- [ ] #6 M2 exit condition is re-evaluated after these checks and the targeted integration gate pass.
