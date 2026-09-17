---
id: VID-25
title: Add one-command MVP product UI dry-run
status: In Progress
assignee: []
created_date: '2026-09-17 20:32'
labels: [m4, mvp, ui, publishing, launch]
dependencies:
  - VID-24
priority: high
type: feature
ordinal: 25000
---

## Description

Make the current product UI directly testable from a fresh checkout with one repository-owned command. Local development must compose the authenticated product BFF, seeded demo project/asset, fake publisher and web same-origin proxy without external provider credentials.

The UI may enqueue publish only in explicit fake mode. Production/default YouTube mode must remain fail-closed until VID-12 real provider verification is recorded.

## Acceptance Criteria
- [x] #1 Root exposes `pnpm mvp:ui` to start the local product BFF and web server together.
- [x] #2 Local demo runtime is loopback-only, refuses production mode, seeds a demo owner/project/video asset and uses the deterministic fake publisher.
- [x] #3 Product BFF exposes authenticated runtime publish capability and defaults to YouTube/locked when runtime options are not explicitly supplied.
- [x] #4 Fake publish dry-run requires explicit fake mode, explicit user confirmation and the existing publish approval/capability checks.
- [x] #5 Product UI shows the dry-run action only when the authenticated runtime reports fake publishing enabled.
- [x] #6 Dry-run result is linked to the normal project-scoped job status flow and reports no external provider side effect.
- [x] #7 Product job polling recognizes canonical queue terminal status `completed`.
- [x] #8 Production real publish enqueue remains unavailable and VID-12 remains the launch gate.
- [ ] #9 Exact-head CI passes architecture, typecheck and workspace tests.
- [x] #10 No provider expansion, database migration, runtime dependency, lockfile or GitHub Actions workflow is introduced.
