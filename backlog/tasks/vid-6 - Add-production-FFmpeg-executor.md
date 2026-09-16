---
id: VID-6
title: Add production FFmpeg executor
status: To Do
assignee: []
created_date: '2026-09-16 21:58'
labels: [m3, media, ffmpeg, security]
dependencies:
  - VID-2
  - VID-4
documentation:
  - docs/roadmap.md
  - docs/architecture/system.md
priority: high
type: feature
ordinal: 6000
---

## Description

Implement the first real media executor behind the existing `MediaExecutor` boundary using FFmpeg/ffprobe without leaking process or filesystem details into the media-worker service.

The executor must build arguments from typed operations rather than accepting arbitrary shell fragments. Execution is local-first, deterministic, project/object-store aware, and bounded by explicit path, duration, output-size, and process limits.

## Acceptance Criteria
- [ ] #1 FFmpeg is invoked without a shell and only from typed/validated transform operations.
- [ ] #2 Input/output paths are constrained to an execution sandbox and cannot escape via traversal/symlink tricks.
- [ ] #3 Process timeout, termination, stderr capture bounds, and output-size/resource limits are explicit.
- [ ] #4 Output naming is deterministic from project/job/asset context and does not overwrite unrelated assets.
- [ ] #5 At least trim plus one resize/transcode path are covered by tests or a deterministic fixture smoke scenario.
- [ ] #6 Executor/provider errors are normalized before reaching public API/event projections.
- [ ] #7 No FFmpeg-specific logic is added to the orchestrator or core contracts beyond capability-neutral fields already required by media transforms.
