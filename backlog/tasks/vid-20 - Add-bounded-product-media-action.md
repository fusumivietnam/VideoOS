---
id: VID-20
title: Add bounded product media action
status: In Progress
assignee: []
created_date: '2026-09-17 08:32'
labels: [m7, product, media, bff, launch]
dependencies:
  - VID-19
priority: high
type: feature
ordinal: 20000
---

## Description

Add the first authenticated product mutation required for evaluation: create a project-scoped media job from an existing asset through the product BFF. Keep the command bounded to the canonical `MediaTransformRequest` shape, reject arbitrary process/FFmpeg arguments, and continue to enforce `asset.write` plus asset/project isolation inside `VideoOsApi`.

Expose one fixed `Create 720p proxy` action in the product UI for roles that can write assets. Publishing mutation remains out of scope until the first YouTube live path is verified or explicitly waived.

## Acceptance Criteria
- [ ] #1 Authenticated `POST /api/product/projects/:projectId/media-jobs` validates bounded `assetId`, `jobId`, media operations and output fields before calling `VideoOsApi.createMediaJob`.
- [ ] #2 Raw FFmpeg/process arguments, unsafe codec/container tokens, excessive dimensions/fps/operation counts and malformed operations are rejected with `400`.
- [ ] #3 Project membership/capability remains authoritative: roles without `asset.write` receive `403` and cross-project/missing assets cannot be queued.
- [ ] #4 Valid requests enqueue the canonical `media` job payload and return `202 { jobId }` without bypassing queue/idempotency boundaries.
- [ ] #5 Product UI offers a fixed `Create 720p proxy` action only for owner/admin/editor video assets and automatically exposes the resulting job id in job lookup.
- [ ] #6 Tests cover valid enqueue, denied viewer, cross-project asset rejection, malformed/unbounded transform rejection and unsafe token rejection.
- [ ] #7 Publish mutation/provider expansion remains unchanged and locked behind existing approval/VID-12 gates.
- [ ] #8 No new runtime dependency, database migration, managed service, provider adapter, lockfile change or GitHub Actions workflow is introduced.
