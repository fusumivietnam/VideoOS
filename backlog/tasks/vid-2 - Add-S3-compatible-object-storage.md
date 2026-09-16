---
id: VID-2
title: Add S3-compatible object storage
status: To Do
assignee: []
created_date: '2026-09-16 21:18'
labels: [m2, storage]
dependencies: []
documentation:
  - docs/roadmap.md
  - docs/architecture/system.md
priority: high
type: feature
ordinal: 2000
---

## Description

Implement the first durable `ObjectStore` adapter behind the existing storage port without leaking provider SDK types into core contracts. Development must remain local/free-first while deployment stays compatible with S3-style cloud storage.

Prefer a deterministic local filesystem path for the cheapest developer loop and an S3-compatible adapter suitable for MinIO/R2/AWS-style backends. Project-scoped object keys and idempotent writes must remain explicit.

## Acceptance Criteria
- [ ] #1 A concrete S3-compatible adapter implements the existing object-store contract without changing core/domain semantics.
- [ ] #2 Local development has a no-managed-service path, using local filesystem and/or MinIO as documented.
- [ ] #3 Object keys remain project-scoped and deterministic.
- [ ] #4 Upload/download/delete behavior has dependency-light tests where possible.
- [ ] #5 Provider credentials remain application-edge configuration and never enter browser/public contracts.
- [ ] #6 No new GitHub Actions workflow is introduced.
