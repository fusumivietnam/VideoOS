---
id: VID-3
title: Add targeted PostgreSQL integration gate
status: In Progress
assignee: []
created_date: '2026-09-16 21:18'
labels: [m2, durability]
dependencies: []
documentation:
  - docs/roadmap.md
  - packages/adapters/persistence-postgres/README.md
  - .github/workflows/ci.yml
priority: high
type: enhancement
ordinal: 3000
---

## Description

Promote the existing manual PostgreSQL integration scenario into a path-gated validation step only when durable-runtime/persistence paths change. Keep the existing single `CI / quality` workflow and avoid starting PostgreSQL for unrelated pull requests.

The gate detects relevant files with native Git rather than adding another path-filter action. On pull requests that touch durable paths, it starts the existing local PostgreSQL Compose service after normal architecture/typecheck/unit tests pass, runs migrations, then runs the durable integration script. `workflow_dispatch` always enables the integration gate for explicit verification. The post-merge `push` run skips the database step so the PR gate is not paid twice.

## Acceptance Criteria
- [ ] #1 The existing CI workflow detects relevant persistence/runtime path changes without adding a second workflow.
- [ ] #2 PostgreSQL is started only for relevant pull-request changes or explicit manual execution.
- [ ] #3 Migrations run before integration assertions.
- [ ] #4 Integration coverage includes leasing, final-attempt exhaustion, outbox behavior, transaction rollback, and atomic queue settlement.
- [ ] #5 Unrelated documentation/UI/provider-only pull requests do not pay PostgreSQL startup cost.
- [ ] #6 CI permissions remain read-only unless a narrowly documented write capability is required.
