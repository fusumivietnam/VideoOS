---
id: VID-24
title: Add MVP smoke command
status: Done
assignee: []
created_date: '2026-09-17 12:46'
labels: [m4, mvp, smoke, publishing, launch]
dependencies:
  - VID-23
priority: high
type: feature
ordinal: 24000
---

## Description

Add one repository-owned command that runs the current MVP publish path end to end without external credentials. The smoke must use the same runtime config boundary, fake publisher port, publish preflight/approval path, job queue and runtime worker used by the product code.

This is a dry-run confidence tool, not a substitute for VID-12 real YouTube verification.

## Acceptance Criteria
- [x] #1 Root exposes `pnpm mvp:smoke`.
- [x] #2 Smoke creates a project-scoped video asset in an in-memory runtime and uses the typed runtime config with explicit fake publisher driver.
- [x] #3 Smoke runs publish preflight and verifies approval is required.
- [x] #4 Smoke creates an approved publish job and verifies canonical queue state before execution.
- [x] #5 Smoke executes `runPublishOnce()` and verifies the lifecycle completion event and terminal `completed` job state.
- [x] #6 Smoke prints a compact JSON summary suitable for local/manual validation.
- [x] #7 Exact-head CI #192 passes architecture, typecheck and workspace tests.
- [x] #8 No production credential, provider expansion, database migration, dependency, lockfile or GitHub Actions workflow change is introduced.
