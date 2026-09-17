---
id: VID-19
title: Add product web views
status: In Progress
assignee: []
created_date: '2026-09-17 08:05'
labels: [m7, product, web, bff, launch]
dependencies:
  - VID-18
priority: high
type: feature
ordinal: 19000
---

## Description

Turn the existing dependency-free web shell into the first user-facing product read surface without bypassing the authenticated BFF or project capability checks. Serve a product login/project/assets/job UI from the web origin and proxy `/api/product/*` to the internal product BFF so browser traffic remains same-origin and the BFF is not exposed directly.

This slice remains read-only. It does not add media/publish mutations, direct database access, provider logic, a frontend framework dependency, or a second HTTP gateway.

## Acceptance Criteria
- [ ] #1 `/product.html` provides a bounded product login flow using the existing product session endpoint and never embeds configured identities/access codes/secrets.
- [ ] #2 Authenticated users can list only their projects and select a project to view authorized assets.
- [ ] #3 Users can query a job id within the selected project and see normalized job status without exposing cross-project jobs.
- [ ] #4 Browser product requests use same-origin `/api/product/*`; the web server proxies to one explicitly configured internal BFF origin and forwards only required method/body/content-type/cookie state.
- [ ] #5 Product proxy fails closed with `503 product_bff_unavailable` when no BFF origin is configured and applies bounded request bodies/no-store/security headers.
- [ ] #6 Product session `Set-Cookie`, upstream status, JSON body and authorization failures survive the proxy without exposing the internal origin to browser code.
- [ ] #7 Tests cover static product delivery, unavailable BFF behavior and authenticated same-origin proxy behavior.
- [ ] #8 No new runtime dependency, lockfile change, database schema migration, provider adapter, managed auth service, or GitHub Actions workflow is introduced.
