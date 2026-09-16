---
id: VID-12
title: Add YouTube credential onboarding and live verification
status: In Progress
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
- [x] #1 OAuth client/refresh credentials stay server-side and access tokens are refreshed without entering publish payloads.
- [x] #2 Credential records are project/account scoped and can be explicitly disconnected/rotated.
- [ ] #3 A manual live smoke command verifies private upload, normalized receipt, and reconciliation against a test channel.
- [x] #4 Live verification is opt-in and never runs in normal CI.
- [x] #5 Failure diagnostics redact tokens/client secrets and remain bounded.
- [x] #6 Operational notes document Google project audit/private-video constraints and required OAuth scopes.
- [ ] #7 A second publishing provider is not started until this live path is verified or explicitly waived with a recorded decision.

## Implementation progress — 2026-09-17

- Added project/account-scoped `YouTubeOAuthCredentialStore` plus a local/self-hosted JSON-file implementation with atomic `0600` writes.
- Added authorization URL, authorization-code exchange, rotation and disconnect lifecycle through `YouTubeCredentialManager`.
- Added `RefreshingYouTubeCredentialProvider` with short-lived access-token caching and server-side refresh-token exchange.
- Added fake-endpoint tests for refresh, connect/rotate/disconnect, bounded diagnostics and scope/consent URL behavior.
- Added `youtube:credentials` and explicit `VIDEOOS_YOUTUBE_LIVE_SMOKE=1` `youtube:live-smoke` commands.
- Added `docs/operations/youtube-oauth.md` with scope, audit/private-video, secret-handling and manual verification guidance.
- Remaining acceptance gate: run the manual command with a dedicated real YouTube test channel, record the resulting video ID/constraints (without secrets), and only then unblock a second provider.
