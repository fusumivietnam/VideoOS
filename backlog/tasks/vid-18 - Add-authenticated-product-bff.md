---
id: VID-18
title: Add authenticated product BFF
status: Done
assignee: []
created_date: '2026-09-17 07:58'
labels: [m7, product, auth, bff, launch]
dependencies:
  - VID-17
priority: high
type: feature
ordinal: 18000
---

## Description

Add the minimum authenticated BFF transport needed for non-operator product evaluation. Exchange a server-side per-user access code for a short-lived HMAC-signed HttpOnly session containing only a principal id, then expose project-scoped read endpoints through the existing `VideoOsApi` read model.

Authentication establishes principal identity only. Project membership/capability checks remain authoritative in the API/domain layer. This slice remains read-only and does not add publish/media mutations.

## Acceptance Criteria
- [x] #1 BFF login exchanges a configured per-user access code for a bounded signed HttpOnly SameSite=Strict session containing a principal id and expiry; raw codes/signing secrets never enter response bodies/logs/repository state.
- [x] #2 Partial/malformed auth configuration fails closed and comparisons are timing-safe.
- [x] #3 `/api/product/me/projects` returns only projects discoverable by the authenticated principal.
- [x] #4 `/api/product/projects/:projectId/assets` and `/api/product/projects/:projectId/jobs/:jobId` delegate to `VideoOsApi` and preserve project authorization/cross-project isolation.
- [x] #5 `/health` remains public; product endpoints require a valid non-expired untampered session.
- [x] #6 Login bodies and path identifiers are bounded; unsupported methods/routes fail without mutating runtime state.
- [x] #7 Tests cover login, invalid credentials, tampered/expired sessions, principal isolation, asset access and cross-project jobs.
- [x] #8 No new runtime dependency, database schema migration, provider adapter, managed auth service, or GitHub Actions workflow is introduced.

## Verification

CI #177 passed architecture boundaries, workspace typecheck and the full workspace test suite after the strict-typing fix. PostgreSQL integration was correctly skipped because no durable persistence path changed.
