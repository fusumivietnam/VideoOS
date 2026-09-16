---
id: VID-6
title: Add production FFmpeg executor
status: Done
assignee: []
created_date: '2026-09-16 21:58'
labels: [m3, media, ffmpeg, security]
dependencies:
  - VID-2
  - VID-4
documentation:
  - docs/roadmap.md
  - docs/architecture/system.md
  - apps/local-runtime/README.md
priority: high
type: feature
ordinal: 6000
---

## Description

Implement the first real media executor behind the existing `MediaExecutor` boundary using FFmpeg without leaking process or filesystem details into the media-worker service.

The executor builds arguments from typed operations rather than accepting arbitrary shell fragments. Execution is local-first, deterministic and bounded by explicit path, duration, stderr, output-size and process limits. Project/job/source-object execution context is internal to the media execution boundary; the public media transform contract remains provider-neutral.

Subtitle burn-in is deliberately rejected until subtitle asset staging is implemented. Media probing, persisted derived-asset lineage and reproducible manifests continue in VID-7.

## Acceptance Criteria
- [x] #1 FFmpeg is invoked without a shell and only from typed/validated transform operations.
- [x] #2 Input/output paths are constrained to an execution sandbox; canonical source paths and symlink escapes are checked before execution.
- [x] #3 Process timeout/termination, bounded stderr capture and output-size limits are explicit.
- [x] #4 Output naming and derived identity are deterministic from project/job/source/transform context and do not overwrite unrelated paths.
- [x] #5 Trim plus resize/transcode argument paths are covered by deterministic tests together with rerun identity stability.
- [x] #6 Executor/process failures are normalized into bounded `FfmpegExecutionError` categories before leaving the executor boundary.
- [x] #7 No FFmpeg-specific logic is added to the orchestrator or public core contracts; concrete process/filesystem logic remains at the application edge.
