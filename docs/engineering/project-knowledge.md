# Engineering project knowledge

VideoOS keeps long-lived engineering state in the repository. Chat threads and generated code-intelligence graphs are convenience layers, not sources of truth.

## Read order for a fresh agent

1. `AGENTS.md` — invariants and required checks.
2. `.project/state.json` — current milestone, focus, blockers, and next task IDs.
3. `docs/roadmap.md` — milestone goals and exit conditions.
4. `backlog/tasks/` — actionable work, dependencies, and acceptance criteria.
5. `backlog/decisions/` — decisions and rationale.
6. Relevant `docs/architecture/` files for cross-cutting changes.
7. `.ua/` when present — derived code/knowledge graph for navigation and impact analysis.

When these sources conflict, verify current Git/source and update the canonical repository record. Never preserve chat context as the only copy of a decision or blocker.

## Backlog.md compatibility

`backlog/config.yml`, `backlog/tasks/`, and `backlog/decisions/` follow Backlog.md's repository format. Backlog tooling is optional developer tooling; it is not a VideoOS runtime dependency.

The current configuration is filesystem-only and does not auto-commit or perform remote operations. This keeps task state reviewable through normal Git/PR workflow.

## Understand Anything

Understand Anything is a developer-side code/knowledge intelligence tool. It analyzes VideoOS and writes rebuildable project data under `.ua/`.

### Claude Code

```text
/plugin marketplace add Egonex-AI/Understand-Anything
/plugin install understand-anything
/understand
```

Useful follow-ups include `/understand-diff`, `/understand-chat <question>`, and `/understand-explain <path-or-symbol>`.

### Codex

On macOS/Linux, install the upstream skill integration:

```bash
curl -fsSL https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.sh | bash -s codex
```

Codex uses the `$` skill prefix, for example:

```text
$understand
$understand-diff
$understand-chat How does the durable publish flow work?
```

### Repository policy for `.ua`

Shareable graph/config artifacts may be committed after review because they can reduce onboarding/re-analysis cost. Local scratch output is ignored:

```text
.ua/intermediate/
.ua/diff-overlay.json
```

Before committing generated artifacts, review them for accidental local paths, secrets, credentials, or other machine-specific data.

## Boundaries

Do not:

- import Understand Anything into `packages/`, `services/`, or runtime application dependencies;
- add a dedicated GitHub Actions workflow for it during M2.K;
- treat `.ua` as authoritative over source, backlog, decisions, or specs;
- add Graphiti/Mem0/RAGFlow solely to preserve engineering chat history.

Later, when multiple consumers justify it, VideoOS may introduce a provider-neutral `ProjectKnowledgePort` with adapters for `.ua`, Git/backlog, pgvector, or temporal knowledge. That belongs on the read/tool side and must not become a dependency of the deterministic job engine.
