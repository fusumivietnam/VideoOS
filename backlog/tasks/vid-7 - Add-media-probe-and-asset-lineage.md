---
id: VID-7
title: Add media probe and asset lineage
status: To Do
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

Use ffprobe or an equivalent executor-side capability behind a provider-neutral boundary. Persist normalized metadata through the existing asset repository/object-store model rather than embedding provider-specific probe payloads into public contracts.

## Acceptance Criteria
- [ ] #1 Source and derived assets can record normalized duration, dimensions, codecs, frame/audio metadata required by VideoOS workflows.
- [ ] #2 Derived assets record source asset/job/transform lineage sufficient to reproduce or audit the operation.
- [ ] #3 Raw ffprobe/provider output is normalized and bounded before persistence.
- [ ] #4 Project-scoped object keys remain deterministic and compatible with filesystem/S3 object stores.
- [ ] #5 Probe failure and unsupported-media cases have explicit behavior and tests.
- [ ] #6 A reproducible execution manifest can be constructed from persisted source metadata, transform plan, executor version, and output metadata.
