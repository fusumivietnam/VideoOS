---
id: VID-11
title: Add first production publishing adapter
status: Done
assignee: []
created_date: '2026-09-16 23:34'
labels: [m4, publishing, adapter, reconciliation]
dependencies:
  - VID-4
priority: high
type: feature
ordinal: 11000
---

## Description

Implement the first real network publishing adapter behind the provider-neutral publisher boundary. YouTube is the first adapter. It isolates credentials server-side, performs resumable upload through native Node fetch, persists retry-safe attempt state through the existing generic JSON store, and reconciles uncertain remote outcomes before permitting another upload.

Live provider credentials remain an explicit/manual verification step; automated CI uses fake transports only.

## Acceptance Criteria
- [x] #1 A platform capability matrix defines YouTube upload, scheduling, reconciliation, asset-count, and credential constraints.
- [x] #2 Credentials stay behind `YouTubeCredentialProvider` and never enter public/browser contracts.
- [x] #3 Upload/create operations use deterministic idempotency markers plus prepared/uncertain/confirmed attempt state and normalized publish receipts.
- [x] #4 Provider retryable failures and rate limits map to bounded publisher errors while QueueRunner remains the max-attempt authority.
- [x] #5 Reconciliation searches only authenticated-owned candidates and verifies exact marker tag/channel before normalizing remote state.
- [x] #6 Integration tests use fake/stub transport; live-provider testing remains explicit/manual.
- [x] #7 No additional GitHub Actions workflow was introduced; CI #148 passed architecture, strict typecheck, workspace tests, and PostgreSQL integration.

## Operational note

The adapter code path is production-oriented, but OAuth credential onboarding/refresh and the first live-provider smoke test are tracked separately so provider secrets never become a CI dependency.
