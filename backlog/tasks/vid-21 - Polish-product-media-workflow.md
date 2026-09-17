---
id: VID-21
title: Polish product media workflow
status: Done
assignee: []
created_date: '2026-09-17 08:45'
labels: [m7, product, web, media, launch]
dependencies:
  - VID-20
priority: high
type: feature
ordinal: 21000
---

## Description

Polish the existing authenticated product surface so the first media mutation is understandable and usable during alpha evaluation. Keep the workflow bounded to the already-authorized 720p proxy action, automatically track a newly queued job for a limited period, and refresh project assets when processing succeeds.

This slice does not add publish mutation, raw media controls, provider expansion, database changes, or a frontend framework.

## Acceptance Criteria
- [x] #1 Product copy reflects that bounded media processing is available while publishing remains gated.
- [x] #2 A newly created media job is automatically polled through the existing project-scoped job endpoint with a bounded interval and maximum attempt count.
- [x] #3 Polling stops on terminal status, project switch, logout, authentication loss, or maximum attempts.
- [x] #4 Successful jobs trigger one authorized project asset refresh; failed/cancelled jobs surface terminal status without retry loops.
- [x] #5 Users can manually refresh assets and manually query a job after automatic tracking ends.
- [x] #6 UI clearly differentiates read-only roles from roles allowed to create media work.
- [x] #7 Publish action/provider expansion remains unchanged and locked behind VID-12 verification.
- [x] #8 No new dependency, lockfile change, schema migration, managed service, provider adapter, or GitHub Actions workflow is introduced.

## Verification
- CI #183: architecture boundaries, strict typecheck, and workspace tests passed.
- PostgreSQL durable integration was skipped by the existing path gate because this slice only changes web/product UX and canonical metadata.
