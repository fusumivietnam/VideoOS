---
id: VID-11
title: Add first production publishing adapter
status: To Do
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

Begin M4 by implementing one real network publishing adapter behind the existing provider-neutral publisher boundary. The first adapter must prove credential isolation, idempotent create/upload behavior, normalized receipts, retry/rate-limit translation, and reconciliation without introducing provider-specific branching into publisher core.

Prefer the lowest-cost developer path and keep credentials server-side only. Do not add a second provider until the first adapter's recovery semantics are demonstrated.

## Acceptance Criteria
- [ ] #1 A documented platform capability matrix defines supported publish operations and constraints for the first adapter.
- [ ] #2 Credentials stay behind a server-side credential boundary and never enter public/browser contracts.
- [ ] #3 Upload/create operations are idempotent across queue retries and normalized to existing publish receipts.
- [ ] #4 Provider retryable failures and rate limits map to bounded publisher errors without bypassing queue max-attempt rules.
- [ ] #5 Reconciliation can detect and normalize remote-state drift after accepted/published results.
- [ ] #6 Integration tests use fake/stub transport by default; live-provider testing remains explicit/manual.
- [ ] #7 No additional GitHub Actions workflow is introduced.
