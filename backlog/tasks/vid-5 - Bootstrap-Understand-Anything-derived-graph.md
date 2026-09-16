---
id: VID-5
title: Bootstrap Understand Anything derived graph
status: To Do
assignee: []
created_date: '2026-09-16 21:18'
labels: [m2k, project-brain]
dependencies:
  - VID-1
documentation:
  - docs/engineering/project-knowledge.md
priority: medium
type: enhancement
ordinal: 5000
---

## Description

Run Understand Anything locally through the developer's Codex or Claude Code environment, generate the initial `.ua` project graph, inspect it for path/privacy issues, and commit only the shareable derived artifacts that materially improve onboarding and impact analysis.

This is intentionally a developer-local task. Do not add Understand Anything to VideoOS runtime dependencies or create a GitHub Actions workflow for it.

## Acceptance Criteria
- [ ] #1 Understand Anything is installed locally in at least one supported coding-agent environment.
- [ ] #2 The initial VideoOS analysis completes and creates `.ua` project metadata/knowledge graph artifacts.
- [ ] #3 Generated output is reviewed for sensitive/local-only data before commit.
- [ ] #4 `.ua/intermediate/` and `.ua/diff-overlay.json` remain untracked.
- [ ] #5 A fresh agent can use the committed graph plus canonical repository state to answer a cross-package architecture question without historical chat context.
- [ ] #6 No runtime package or CI workflow depends on Understand Anything.
