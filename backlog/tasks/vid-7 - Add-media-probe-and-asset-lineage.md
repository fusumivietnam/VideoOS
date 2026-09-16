---
id: VID-7
title: Add media probe and asset lineage
status: Done
assignee: []
created_date: '2026-09-16 21:58'
labels: [m3, media, metadata, lineage]
dependencies:
  - VID-6
documentation:
  - docs/roadmap.md
  - packages/storage/src/index.ts
priority: high
type: feature
ordinal: 7000
---

## Description

Add deterministic media probing and derived-asset lineage so every generated asset records normalized technical metadata and the source/transform relationship required for reproducibility and debugging.

Delivered through a bounded `ffprobe` capability at the application edge plus a provider-neutral media artifact finalizer. Raw probe payloads are normalized before persistence. Derived outputs are staged into the configured `ObjectStore`, checksum-addressed through deterministic project-scoped keys, and persisted as `derived-video` asset records with source/job/transform/executor lineage. Finalization is idempotent for queue retries and does not require a PostgreSQL schema migration.

## Acceptance Criteria
- [x] #1 Source and derived assets can record normalized duration, dimensions, codecs, frame/audio metadata required by VideoOS workflows.
- [x] #2 Derived assets record source asset/job/transform lineage sufficient to reproduce or audit the operation.
- [x] #3 Raw ffprobe/provider output is normalized and bounded before persistence.
- [x] #4 Project-scoped object keys remain deterministic and compatible with filesystem/S3 object stores.
- [x] #5 Probe failure and unsupported-media cases have explicit behavior and tests.
- [x] #6 A reproducible execution manifest can be constructed from persisted source metadata, transform plan, executor version, and output metadata.
