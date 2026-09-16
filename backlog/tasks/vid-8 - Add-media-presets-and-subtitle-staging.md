---
id: VID-8
title: Add media presets and subtitle staging
status: To Do
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

Turn the low-level typed media operations into reusable production presets and complete asset staging for subtitle burn-in. Presets must compile deterministically into the existing transform operations; they must not add provider-specific branching to the media-worker core.

Subtitle assets must be resolved through the asset repository/object-store boundary, staged inside the FFmpeg sandbox, and referenced through generated arguments rather than arbitrary user-supplied filter fragments.

## Acceptance Criteria
- [ ] #1 Reusable output presets compile deterministically into existing typed media operations/output settings.
- [ ] #2 At least vertical short-form, landscape HD, and square presets are covered by tests.
- [ ] #3 Subtitle assets are project-authorized/resolved and staged inside the execution sandbox before burn-in.
- [ ] #4 Subtitle filenames/paths cannot escape the sandbox or inject FFmpeg filter syntax.
- [ ] #5 Preset identity/config is represented in reproducible transform lineage.
- [ ] #6 No new GitHub Actions workflow is introduced.
