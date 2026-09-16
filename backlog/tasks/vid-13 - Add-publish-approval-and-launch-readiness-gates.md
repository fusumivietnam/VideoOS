---
id: VID-13
title: Add publish approval and launch readiness gates
status: In Progress
assignee: []
created_date: '2026-09-17 00:35'
labels: [m4, publishing, approval, scheduling, launch]
dependencies:
  - VID-11
priority: high
type: feature
ordinal: 13000
---

## Description

Prepare VideoOS for an initial controlled launch without weakening provider or queue boundaries. Require an explicit project-authorized publish approval before a publish job can be enqueued, preserve the approval record with the internal job payload for audit, validate project asset ownership and scheduling timestamps before enqueue, and document a minimal launch-readiness gate.

This work may be developed in parallel with VID-12, but it must not unlock a second network provider or autonomous/bulk publishing. The YouTube live-provider verification gate remains authoritative.

## Acceptance Criteria
- [ ] #1 `publish.create` requesters still require project authorization and every queued publish additionally carries an explicit approver with `publish.manage` capability.
- [ ] #2 Missing or unauthorized approval fails before any publish job is enqueued.
- [ ] #3 Approval identity/timestamp is preserved in the internal publish job payload while provider adapters receive only the existing `PublishRequest`.
- [ ] #4 Every referenced publish asset must exist and belong to the request project before enqueue.
- [ ] #5 `scheduledAt`, when present, must be a valid ISO timestamp; provider scheduling semantics remain adapter-owned.
- [ ] #6 Local runtime smoke tests cover approved publish plus rejected missing/unauthorized approval paths.
- [ ] #7 Launch runbook distinguishes automated readiness checks from the remaining manual YouTube live-provider gate and prohibits a second provider until VID-12 is verified or waived.
- [ ] #8 No additional GitHub Actions workflow is introduced.
