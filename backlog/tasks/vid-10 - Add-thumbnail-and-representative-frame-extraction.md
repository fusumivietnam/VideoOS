---
id: VID-10
title: Add thumbnail and representative-frame extraction
status: To Do
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
  - apps/local-runtime/src/ffmpeg-executor.ts
  - apps/local-runtime/src/media-artifact.ts
priority: medium
type: feature
ordinal: 10000
---

## Description

Complete the remaining M3 media production path with deterministic thumbnail/representative-frame extraction. Thumbnail generation must reuse the existing sandboxed FFmpeg execution, object-store persistence, normalized metadata, and asset-lineage conventions rather than introducing a second media pipeline.

## Acceptance Criteria
- [ ] #1 A typed thumbnail/frame extraction request compiles to bounded FFmpeg arguments without arbitrary filter input.
- [ ] #2 Output identity/object key is deterministic and project-scoped.
- [ ] #3 Extracted images persist as image assets with source/job/transform lineage and checksum metadata.
- [ ] #4 Frame selection behavior is explicit for requested timestamp and representative-frame defaults.
- [ ] #5 Local execution and local-node execution can use the same thumbnail path.
- [ ] #6 M3 exit condition is verified after thumbnail extraction passes CI.
