---
id: VID-2
title: Add S3-compatible object storage
status: In Progress
assignee: []
created_date: '2026-09-16 21:18'
labels: [m2, storage]
dependencies: []
documentation:
  - docs/roadmap.md
  - docs/architecture/system.md
  - apps/local-runtime/README.md
priority: high
type: feature
ordinal: 2000
---

## Description

Implement the first durable `ObjectStore` adapter behind the existing storage port without leaking provider SDK types into core contracts. Development must remain local/free-first while deployment stays compatible with S3-style cloud storage.

Phase A provides a dependency-free local filesystem implementation at the application edge. It uses sandboxed object keys, optional SHA-256 verification, temporary-file + rename commits, and idempotent deletion. It deliberately does not pretend local filesystem paths are signed URLs.

Phase B will add a concrete S3-compatible provider adapter suitable for MinIO/R2/AWS-style backends and provider-backed signed read URLs. Do not hand-roll AWS SigV4 solely to avoid an SDK dependency; choose the provider dependency explicitly and update the lockfile in that dedicated batch.

## Acceptance Criteria
- [ ] #1 A concrete S3-compatible adapter implements the existing object-store contract without changing core/domain semantics.
- [x] #2 Local development has a no-managed-service filesystem path and its behavior is documented.
- [ ] #3 Object keys remain project-scoped and deterministic across both local and S3-compatible implementations.
- [x] #4 Local upload/download/delete, path sandboxing, checksum validation, and signed-URL limitation have dependency-light tests.
- [ ] #5 Provider credentials remain application-edge configuration and never enter browser/public contracts.
- [x] #6 No new GitHub Actions workflow is introduced.
