---
id: VID-4
title: Add durable runtime operational safety
status: Done
assignee: []
created_date: '2026-09-16 21:18'
labels: [m2, operations, durability]
dependencies:
  - VID-2
documentation:
  - docs/roadmap.md
  - packages/adapters/persistence-postgres/README.md
  - docs/operations/backup-restore.md
  - packages/adapters/storage-s3/README.md
priority: medium
type: enhancement
ordinal: 4000
---

## Description

Close the operational portion of M2 by documenting backup/restore and exposing durable-runtime health/readiness signals that distinguish process liveness from dependency readiness.

The PostgreSQL runtime exposes process liveness independently from readiness. Readiness verifies database connectivity plus the required migration set and returns bounded operational status without leaking raw provider errors or credentials. Backup/restore guidance now covers PostgreSQL plus both the dependency-free filesystem object store and the provider-backed S3-compatible deployment path.

The M2 exit condition has been re-evaluated after the targeted PostgreSQL integration gate passed and S3-compatible storage landed: queued work and terminal workflow metadata are restart-safe, terminal queue settlement is atomic with lifecycle outbox persistence, and recovery semantics are documented for control-plane state plus object bytes.

## Acceptance Criteria
- [x] #1 Durable runtime exposes a lightweight liveness signal.
- [x] #2 Readiness verifies required durable dependencies without leaking credentials or internal provider errors.
- [x] #3 PostgreSQL migration state is covered by operational documentation or readiness behavior.
- [x] #4 Backup and restore procedures are documented for the selected local-first database/object-storage setup and S3-compatible deployment path.
- [x] #5 Recovery notes cover queued work, outbox records, object metadata consistency, and provider-backed object bytes.
- [x] #6 M2 exit condition is re-evaluated after these checks and the targeted integration gate pass.
