---
id: VID-3
title: Add targeted PostgreSQL integration gate
status: To Do
assignee: []
created_date: '2026-09-16 21:18'
labels: [m2, durability]
dependencies: []
documentation:
  - docs/roadmap.md
  - packages/adapters/persistence-postgres/README.md
priority: high
type: enhancement
ordinal: 3000
---

## Description

Promote the existing manual PostgreSQL integration scenario into a path-gated validation step only when durable-runtime/persistence paths change. Keep the existing single `CI / quality` workflow and avoid starting PostgreSQL for unrelated pull requests.

The gate must exercise migrations plus durable queue/outbox semantics, including atomic terminal settlement rollback.

## Acceptance Criteria
- [ ] #1 The existing CI workflow detects relevant persistence/runtime path changes without adding a second workflow.
- [ ] #2 PostgreSQL is started only for relevant changes or explicit manual execution.
- [ ] #3 Migrations run before integration assertions.
- [ ] #4 Integration coverage includes leasing, final-attempt exhaustion, outbox behavior, transaction rollback, and atomic queue settlement.
- [ ] #5 Unrelated documentation/UI/provider-only pull requests do not pay PostgreSQL startup cost.
- [ ] #6 CI permissions remain read-only unless a narrowly documented write capability is required.
