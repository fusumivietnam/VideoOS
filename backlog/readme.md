# VideoOS backlog

This directory is canonical engineering work/decision state and is compatible with Backlog.md-style filesystem workflows.

- `tasks/` — actionable work, status, dependencies, acceptance criteria.
- `decisions/` — durable engineering decisions and rationale.
- `config.yml` — local filesystem-only project configuration.

`docs/roadmap.md` remains the milestone-level plan. `.project/state.json` is the compact machine-readable snapshot that points agents to the current work.

Do not move task/decision truth into chat memory or generated `.ua` knowledge graphs. Generated intelligence may index these files, but Git remains authoritative.
