---
id: VID-9
title: Add optional local-node media execution
status: Done
assignee: []
created_date: '2026-09-16 22:18'
labels: [m3, media, local-node, gpu]
dependencies:
  - VID-6
  - VID-7
  - VID-8
documentation:
  - docs/roadmap.md
  - packages/node-protocol
  - apps/local-runtime
priority: medium
type: feature
ordinal: 9000
---

## Description

Add an optional local-node execution adapter for heavy/GPU media work while keeping the canonical media plan, storage, lineage, retry, and authorization semantics identical to local runtime execution.

Delivered as a lease transport around the existing queue-backed workflow rather than a second workflow engine. Each queue attempt dispatches at most one node lease; transport/remote failures return to the existing QueueRunner retry/dead-letter rules. The node protocol carries generic CPU/GPU requirements, successful results are deduplicated/reused, failed results can be superseded by the next queue attempt, and a local node agent reconstructs the same provider-neutral media plan for any underlying `MediaExecutor`.

## Acceptance Criteria
- [x] #1 Media jobs can be delegated through the existing node protocol without changing public media contracts.
- [x] #2 Node leases/retries cannot execute beyond the queue max-attempt rules.
- [x] #3 Node result artifacts use the same object-store/asset-lineage finalization path as local FFmpeg execution.
- [x] #4 Capability/resource metadata can distinguish CPU/GPU nodes without provider-specific branching in core services.
- [x] #5 Disconnect/reconnect and duplicate-result behavior are explicit and covered by tests.
- [x] #6 M3 exit condition is re-evaluated after the local-node path is proven; M3 remains active because the thumbnail/representative-frame path is still outstanding.
