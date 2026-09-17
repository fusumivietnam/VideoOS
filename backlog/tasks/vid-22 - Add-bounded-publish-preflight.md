---
id: VID-22
title: Add bounded publish preflight
status: In Progress
assignee: []
created_date: '2026-09-17 10:29'
labels: [m4, product, publishing, youtube, launch]
dependencies:
  - VID-21
  - VID-13
priority: high
type: feature
ordinal: 22000
---

## Description

Add the last non-publishing product slice before controlled YouTube publish is exposed. Reuse the canonical publish validation path to let an authenticated user validate one YouTube target, one project-scoped video asset, caption and optional schedule without enqueueing a publish job.

The product UI may prepare and validate the request, but the endpoint must explicitly report that enqueue is not allowed. Approval requirements and VID-12 live-provider verification remain authoritative gates for real publishing.

## Acceptance Criteria
- [ ] #1 `VideoOsApi.preflightPublish` reuses the same publish capability, asset/project and schedule validation used by `createPublish` without enqueueing a job.
- [ ] #2 Authenticated product BFF exposes a bounded YouTube-only preflight endpoint with one target/asset and bounded account/idempotency/caption/schedule fields.
- [ ] #3 Preflight response explicitly reports approval required and `enqueueAllowed: false`.
- [ ] #4 Viewer/unauthorized project access is rejected and cross-project/missing assets return a bounded not-found response.
- [ ] #5 Malformed schedule, mime type, account/idempotency identifiers and oversized captions are rejected before reaching provider/worker code.
- [ ] #6 Product UI can select a video asset, enter YouTube account/caption/schedule and display preflight results without exposing a real publish action.
- [ ] #7 Tests prove successful preflight creates no publish queue job and cover authorization/isolation/bounded validation failures.
- [ ] #8 No provider expansion, secret exposure, database migration, managed service, runtime dependency, lockfile change or GitHub Actions workflow is introduced.
