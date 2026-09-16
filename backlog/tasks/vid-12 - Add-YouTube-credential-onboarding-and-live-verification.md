---
id: VID-12
title: Add YouTube credential onboarding and live verification
status: To Do
assignee: []
created_date: '2026-09-16 23:52'
labels: [m4, publishing, youtube, oauth, credentials]
dependencies:
  - VID-11
priority: high
type: feature
ordinal: 12000
---

## Description

Make the first YouTube adapter operable with real accounts without weakening the credential boundary. Add an OAuth refresh-capable server-side credential implementation, explicit connect/disconnect lifecycle, and a manual live smoke path that verifies upload/reconciliation against a dedicated test channel.

This task must not place provider secrets in GitHub Actions or public/browser contracts. Prefer a local/self-hosted secret path first; managed vaults may be added later behind the same credential interface.

## Acceptance Criteria
- [ ] #1 OAuth client/refresh credentials stay server-side and access tokens are refreshed without entering publish payloads.
- [ ] #2 Credential records are project/account scoped and can be explicitly disconnected/rotated.
- [ ] #3 A manual live smoke command verifies private upload, normalized receipt, and reconciliation against a test channel.
- [ ] #4 Live verification is opt-in and never runs in normal CI.
- [ ] #5 Failure diagnostics redact tokens/client secrets and remain bounded.
- [ ] #6 Operational notes document Google project audit/private-video constraints and required OAuth scopes.
- [ ] #7 A second publishing provider is not started until this live path is verified or explicitly waived with a recorded decision.
