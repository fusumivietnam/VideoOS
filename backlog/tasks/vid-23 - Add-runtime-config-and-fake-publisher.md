---
id: VID-23
title: Add runtime config boundary and fake publisher
status: In Progress
assignee: []
created_date: '2026-09-17 10:32'
labels: [m4, config, publishing, runtime, mvp]
dependencies:
  - VID-22
priority: high
type: feature
ordinal: 23000
---

## Description

Establish the minimum typed runtime configuration boundary required to finish and test the MVP without prematurely building a configuration platform. Keep parsing at the local composition root for now, provide deterministic fake publishing for development/test, and keep production YouTube composition fail-closed unless a real adapter is explicitly supplied.

This slice must enable an API -> approval -> publish queue -> worker -> terminal job test run without external provider credentials while preserving VID-12 as the real-provider launch gate.

## Acceptance Criteria
- [ ] #1 Runtime mode, web/BFF host/ports and publisher driver are parsed once through a typed fail-fast composition-root config boundary.
- [ ] #2 Development/test default to `fake` publisher while production defaults to `youtube`.
- [ ] #3 Invalid mode/driver/host/port values fail at config load rather than during job execution.
- [ ] #4 Deterministic fake network publisher implements the existing publisher adapter boundary and produces normalized synthetic receipts without network/credentials.
- [ ] #5 Publisher composition creates fake YouTube adapter for local/test and fails closed when production YouTube adapter is not explicitly supplied.
- [ ] #6 Tests run an approved publish job from API queue creation through `runPublishOnce()` to terminal success without external credentials.
- [ ] #7 Runtime config inventory documents deployment/application/secret/product-policy separation and records the later extraction path to `@videoos/config`.
- [ ] #8 Real YouTube live verification remains required for launch; fake publisher cannot become a production fallback.
- [ ] #9 No database migration, managed config service, new provider, runtime dependency, lockfile change or GitHub Actions workflow is introduced.
