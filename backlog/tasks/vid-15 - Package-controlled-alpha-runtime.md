---
id: VID-15
title: Package controlled alpha runtime
status: In Progress
assignee: []
created_date: '2026-09-17 00:50'
labels: [m4, launch, deployment, web, alpha]
dependencies:
  - VID-14
priority: high
type: feature
ordinal: 15000
---

## Description

Package the read-only launch control plane as a minimal controlled-alpha container without introducing a managed deployment platform, public unauthenticated exposure, provider credentials, or another CI workflow. The image must contain only the launch shell and canonical repository state required to derive readiness.

This task packages an operator/internal alpha surface. It does not make the future authenticated product UI complete and does not satisfy the VID-12 live YouTube verification gate.

## Acceptance Criteria
- [ ] #1 A Node 24 container image starts the existing `apps/web/server.mjs` without installing package dependencies.
- [ ] #2 The image copies only the web shell plus canonical `.project/state.json` and backlog task records needed by `/api/launch-state`.
- [ ] #3 The container has a built-in health check and runs with an unprivileged Node user.
- [ ] #4 `infra/compose.alpha.yml` publishes the cockpit only on `127.0.0.1:3000` by default and uses a read-only filesystem/no-new-privileges where practical.
- [ ] #5 Root commands provide simple `alpha:up`, `alpha:down`, and `alpha:logs` operator workflows without adding dependencies.
- [ ] #6 Documentation states this is an internal/controlled alpha and must not be exposed directly to the public internet before authenticated product UI/reverse-proxy controls exist.
- [ ] #7 Existing tests/CI remain green and no new GitHub Actions workflow is added.
