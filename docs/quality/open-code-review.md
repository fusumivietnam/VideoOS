# OpenCodeReview in VideoOS

## Why it is included

VideoOS uses OpenCodeReview as a focused AI review layer, not as a replacement for compilers, linters, tests, security scanners or human review.

Its architecture matches VideoOS's own design principle: deterministic engineering handles steps that must be correct and repeatable, while an agent handles dynamic reasoning and context retrieval.

## What it adds

- deterministic changed-file selection and filtering;
- path-specific review rules;
- repository context retrieval beyond the diff;
- line-level review comments;
- large-change divide-and-conquer review;
- full-file/repository audit via `ocr scan`;
- resumable review sessions;
- OpenAI-compatible and Anthropic-compatible model endpoints;
- delegation mode for supported coding agents;
- CI/CD and local CLI usage;
- OpenTelemetry support from the upstream project.

## VideoOS policy

OpenCodeReview is initially advisory. It should not block merges until we have measured:

- false-positive rate;
- true defect catch rate;
- median/p95 review latency;
- average token/cost per PR;
- developer accept/fix/ignore ratio;
- categories of defects found that deterministic tooling missed.

Once the signal is strong enough, selected categories may become blocking (for example: security-critical contract breakage, secret exposure, unsafe publishing side effects).

## Repository rules

Project-specific rules live in `.opencodereview/rule.json` and target the highest-risk boundaries:

- contracts and event schemas;
- orchestration and retry/idempotency semantics;
- publishing side effects and rate limits;
- model/tool security boundaries;
- untrusted media handling;
- adapter isolation;
- web authorization and async UX;
- infrastructure least privilege;
- GitHub Actions supply-chain safety.

The upstream tool uses a layered rule model where explicit CLI rules override project rules, project rules override user-global rules, and built-in language rules provide the final fallback.

## CI activation

The workflow is already installed at `.github/workflows/open-code-review.yml`.

Configure:

### Repository secrets

- `OCR_LLM_URL`
- `OCR_LLM_AUTH_TOKEN`

### Repository variables

- `OCR_LLM_MODEL`
- `OCR_LLM_USE_ANTHROPIC` (`true` only for Anthropic-compatible APIs; otherwise `false`)

Until those values are configured, the workflow exits safely after printing activation instructions.

## Trigger modes

- automatically when a PR is opened, synchronized or reopened;
- manually with GitHub Actions `workflow_dispatch`;
- on an existing PR by an owner/member/collaborator comment beginning with:
  - `/open-code-review`
  - `@open-code-review`

Only trusted repository collaborators can trigger comment-based re-review to prevent unauthorized LLM quota consumption.

## Local usage

Install upstream CLI:

```bash
npm install -g @alibaba-group/open-code-review
```

Then:

```bash
pnpm review:preview
pnpm review
pnpm review:scan
```

Useful direct commands:

```bash
ocr rules check services/orchestrator/src/example.ts
ocr review --from main --to HEAD
ocr review --commit <sha>
ocr scan --path services/publisher
ocr review --format json --output result.json
```

## Recommended operating model

### Fast path

For normal PRs:

```text
lint/typecheck/tests -> deterministic security checks -> OpenCodeReview -> human review -> merge
```

### High-risk path

For contracts, auth, publishing, billing/cost controls, infrastructure or migration changes:

```text
normal gates
  -> OpenCodeReview
  -> focused security/compatibility scan
  -> mandatory human owner review
  -> staged rollout
  -> telemetry verification
```

## Do not couple the core to OCR

OpenCodeReview is an external quality tool. VideoOS domain code must not depend on OCR internals. Integration is limited to:

- CI workflows;
- repository review configuration;
- optional telemetry ingestion of review outcomes;
- developer tooling.

This preserves the ability to upgrade, replace or run multiple review engines later.

## Future integration

When the event fabric is running, emit normalized review events such as:

- `code_review.started`
- `code_review.completed`
- `code_review.finding.created`
- `code_review.finding.fixed`
- `code_review.finding.ignored`

These events can feed the engineering flywheel: identify fragile modules, measure defect escape rate, prioritize tests and improve both deterministic rules and AI prompts from real outcomes.
