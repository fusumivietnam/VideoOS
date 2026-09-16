---
id: VID-8
title: Add media presets and subtitle staging
status: Done
assignee: []
created_date: '2026-09-16 22:05'
labels: [m3, media, presets, subtitles]
dependencies:
  - VID-6
  - VID-7
documentation:
  - docs/roadmap.md
  - services/media-worker/src/index.ts
  - apps/local-runtime/src/ffmpeg-executor.ts
priority: high
type: feature
ordinal: 8000
---

## Description

Turn the low-level typed media operations into reusable production presets and complete asset staging for subtitle burn-in. Presets compile deterministically into existing transform operations and carry an explicit id/version through execution and persisted lineage. Subtitle assets are resolved from project-scoped storage, staged into the FFmpeg sandbox under deterministic system-generated filenames, size-bounded, and passed to FFmpeg without accepting arbitrary filter fragments.

## Acceptance Criteria
- [x] #1 Reusable output presets compile deterministically into existing typed media operations/output settings.
- [x] #2 At least vertical short-form, landscape HD, and square presets are covered by tests.
- [x] #3 Subtitle assets are project-authorized/resolved and staged inside the execution sandbox before burn-in.
- [x] #4 Subtitle filenames/paths cannot escape the sandbox or inject FFmpeg filter syntax.
- [x] #5 Preset identity/config is represented in reproducible transform lineage.
- [x] #6 No new GitHub Actions workflow is introduced.
