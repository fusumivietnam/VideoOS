---
id: VID-10
title: Add thumbnail and representative-frame extraction
status: Done
assignee: []
created_date: '2026-09-16 22:32'
labels: [m3, media, thumbnail]
dependencies:
  - VID-6
  - VID-7
  - VID-8
  - VID-9
documentation:
  - docs/roadmap.md
  - apps/local-runtime/src/thumbnail-executor.ts
  - apps/local-runtime/src/thumbnail-artifact.ts
priority: medium
type: feature
ordinal: 10000
---

## Description

Complete the remaining M3 media production path with deterministic thumbnail/representative-frame extraction. Thumbnail generation reuses the existing sandboxed FFmpeg process boundary, object-store persistence, normalized metadata, and asset-lineage conventions rather than introducing a second media pipeline.

## Acceptance Criteria
- [x] #1 A typed thumbnail/frame extraction request compiles to bounded FFmpeg arguments without arbitrary filter input.
- [x] #2 Output identity/object key is deterministic and project-scoped; frame configuration participates in identity.
- [x] #3 Extracted images persist as image assets with source/job/transform lineage and checksum metadata.
- [x] #4 Frame selection behavior is explicit for requested timestamp and representative-frame default (1000 ms).
- [x] #5 Local execution and local-node execution use the same routed thumbnail path.
- [x] #6 M3 exit condition verified after CI #141 passed architecture, strict typecheck, workspace tests, and PostgreSQL integration.
