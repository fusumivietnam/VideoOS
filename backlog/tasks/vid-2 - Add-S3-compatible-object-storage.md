---
id: VID-2
title: Add S3-compatible object storage
status: Done
assignee: []
created_date: '2026-09-16 21:18'
labels: [m2, storage]
dependencies: []
documentation:
  - docs/roadmap.md
  - docs/architecture/system.md
  - apps/local-runtime/README.md
  - packages/adapters/storage-s3/README.md
  - docs/operations/backup-restore.md
priority: high
type: feature
ordinal: 2000
---

## Description

Implement the first durable `ObjectStore` adapters behind the existing storage port without leaking provider SDK types into core contracts. Development remains local/free-first while deployment is compatible with S3-style cloud storage.

Phase A provides a dependency-free local filesystem implementation at the application edge with sandboxed object keys, optional SHA-256 verification, temporary-file + rename commits, and idempotent deletion.

Phase B adds `@videoos/adapter-storage-s3` using AWS SDK v3 for S3-compatible put/get/delete and provider-signed read URLs. The adapter supports custom endpoints/path-style addressing for MinIO and similar services, `region: auto` + custom endpoint for R2-style deployments, and normal AWS S3 configuration. Provider credentials are supplied only at the trusted application/deployment edge.

## Acceptance Criteria
- [x] #1 A concrete S3-compatible adapter implements the existing object-store contract without changing core/domain semantics.
- [x] #2 Local development has a no-managed-service filesystem path and its behavior is documented.
- [x] #3 Object keys remain project-scoped and deterministic across local and S3-compatible implementations.
- [x] #4 Upload/download/delete, signed URL bounds, key validation, checksum handling, and missing-object behavior have dependency-light tests without requiring MinIO in normal CI.
- [x] #5 Provider credentials remain application-edge configuration and never enter browser/public contracts.
- [x] #6 No new GitHub Actions workflow is introduced.
