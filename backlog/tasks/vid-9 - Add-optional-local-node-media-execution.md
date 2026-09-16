---
id: VID-9
title: Add optional local-node media execution
status: To Do
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

The node path must lease bounded work, execute a provider-neutral media plan, return normalized result metadata, and remain idempotent under reconnect/retry. Local-node execution is an adapter, not a second workflow engine.

## Acceptance Criteria
- [ ] #1 Media jobs can be delegated through the existing node protocol without changing public media contracts.
- [ ] #2 Node leases/retries cannot execute beyond the queue max-attempt rules.
- [ ] #3 Node result artifacts use the same object-store/asset-lineage finalization path as local FFmpeg execution.
- [ ] #4 Capability/resource metadata can distinguish CPU/GPU nodes without provider-specific branching in core services.
- [ ] #5 Disconnect/reconnect and duplicate-result behavior are explicit and covered by tests.
- [ ] #6 M3 exit condition is re-evaluated after the local-node path is proven.
