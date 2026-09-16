---
id: VID-14
title: Bootstrap launch control plane shell
status: In Progress
assignee: []
created_date: '2026-09-17 00:42'
labels: [m4, web, control-plane, launch]
dependencies:
  - VID-13
priority: high
type: feature
ordinal: 14000
---

## Description

Provide a dependency-light operator-facing web control plane that can be launched immediately while the full product UI remains later roadmap work. The shell must expose liveness and repository-owned launch/readiness state without introducing provider-specific logic, write access, a second CI workflow, or a new managed service.

This is an alpha/operator surface, not a substitute for the eventual authenticated product UI. It must bind locally by default and remain read-only.

## Acceptance Criteria
- [ ] #1 `apps/web` is executable through root Node 24 scripts using built-ins only, with no new workspace dependency/importer and unchanged frozen-lockfile behavior.
- [ ] #2 The server binds to `127.0.0.1` by default with configurable host/port and exposes `/health`.
- [ ] #3 `/api/launch-state` derives milestone/current focus and launch gates from canonical repository files; chat context is not an input.
- [ ] #4 The browser dashboard clearly shows GO/NOT READY, VID-12 live verification, VID-13 publish safety, current focus, and exact operator commands without exposing secrets.
- [ ] #5 Static serving is allowlisted and response headers include a restrictive CSP plus `no-store` for state endpoints.
- [ ] #6 Node tests cover health, launch-state derivation and static shell delivery.
- [ ] #7 The shell is read-only; it cannot publish, mutate repository state, connect OAuth, or bypass approval/authorization boundaries.
- [ ] #8 Existing single CI workflow remains the only automated quality workflow.
