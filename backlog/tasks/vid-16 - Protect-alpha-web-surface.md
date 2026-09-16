---
id: VID-16
title: Protect alpha web surface
status: In Progress
assignee: []
created_date: '2026-09-17 00:57'
labels: [m4, web, auth, security, launch]
dependencies:
  - VID-15
priority: high
type: feature
ordinal: 16000
---

## Description

Add a dependency-free access gate to the existing read-only alpha cockpit so private/remote evaluation can be protected without turning the web shell into the final multi-user product-auth implementation. Use an explicit server-side access code plus a separately configured HMAC session secret to issue short-lived HttpOnly sessions. Keep health public and keep all product/provider mutations outside this surface.

The access gate is a launch-hardening layer, not a replacement for project-scoped identity/membership authentication required by the future product UI.

## Acceptance Criteria
- [ ] #1 Protected mode requires both a server-side access code and a distinct HMAC session secret; partial/malformed configuration fails closed.
- [ ] #2 Successful login issues a bounded signed HttpOnly `SameSite=Strict` session cookie; raw access/session secrets never enter client state, logs, repository files or response bodies.
- [ ] #3 Invalid/expired/tampered sessions cannot access `/` or `/api/launch-state`; `/health` remains public.
- [ ] #4 Login/logout endpoints accept only bounded request bodies and do not mutate project/runtime/provider state.
- [ ] #5 When protected mode is disabled, localhost behavior remains compatible with VID-14/15 controlled alpha.
- [ ] #6 Starting the standalone server on a non-loopback interface without protected mode fails closed unless an explicit container/local-bind override is set.
- [ ] #7 The localhost-only Compose profile uses the explicit non-loopback-container override but still publishes only `127.0.0.1:3000` on the host.
- [ ] #8 Tests cover protected/unprotected access, login, invalid code, tampered/expired cookie and security headers without adding dependencies or another CI workflow.
