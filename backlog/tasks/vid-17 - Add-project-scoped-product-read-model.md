---
id: VID-17
title: Add project-scoped product read model
status: In Progress
assignee: []
created_date: '2026-09-17 07:50'
labels: [m7, product, identity, api, launch]
dependencies:
  - VID-16
priority: high
type: feature
ordinal: 17000
---

## Description

Add the minimum project-scoped read model required by an authenticated product surface without coupling the web shell to PostgreSQL or provider implementations. A user principal must be able to discover only projects they belong to, then reuse existing capability checks for project assets and job status.

This slice extends stable identity/API ports only. It does not add password storage, OAuth login, product mutations, provider logic, or a second HTTP gateway.

## Acceptance Criteria
- [ ] #1 `MembershipRepository` can list memberships by principal while preserving the existing exact project/principal lookup contract.
- [ ] #2 In-memory and PostgreSQL membership adapters implement principal-scoped listing deterministically.
- [ ] #3 `VideoOsApi.listProjects(principal)` returns only that principal's memberships as a bounded product read model; roles remain canonical.
- [ ] #4 Existing `listAssets` and `getJobStatus` authorization behavior remains project-scoped and cannot expose cross-project data.
- [ ] #5 Tests cover principal project discovery, cross-principal isolation, asset authorization, and cross-project job isolation.
- [ ] #6 PostgreSQL durable integration verifies membership listing against real schema/data.
- [ ] #7 No new runtime dependency, managed service, GitHub Actions workflow, provider adapter, or public write surface is introduced.
