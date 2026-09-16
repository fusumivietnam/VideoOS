# VideoOS controlled launch readiness

This runbook defines the minimum gate for an initial controlled launch. It intentionally favors one verified publishing path over broad provider coverage.

## Automated repository gate

A launch candidate must pass the existing single CI quality workflow:

- architecture boundaries;
- strict workspace typecheck;
- workspace tests;
- path-gated PostgreSQL durable integration when durable persistence paths change.

Do not add a second general CI workflow only for launch readiness. Keep live provider credentials out of GitHub Actions.

## Publish safety gate

Before a publish job is enqueued:

- the requester must have `publish.create` in the target project;
- an explicit approver must have `publish.manage` in the same project;
- the approval timestamp must be a valid ISO date-time;
- every referenced asset must exist and belong to the target project;
- `scheduledAt`, when provided, must be a valid ISO date-time.

The approval record is stored only in the internal publish job payload for audit. Provider adapters continue to receive the provider-neutral `PublishRequest` and do not own approval policy.

For the first launch, owners/admins may approve their own publish request. Editors may prepare/request a publish but cannot approve it unless their role is elevated through the existing membership model.

## Manual external-provider gate

`VID-12` remains the launch-blocking external gate for YouTube:

1. connect a dedicated test account through the server-side OAuth path;
2. run the explicit opt-in private upload smoke;
3. verify the normalized receipt and exact reconciliation result;
4. record only non-secret evidence in `VID-12`;
5. keep OAuth secrets and tokens outside CI/repository state.

A second network adapter must not start until this gate succeeds or a waiver is recorded under `backlog/decisions/`.

## Initial launch scope

The controlled launch scope is intentionally narrow:

- deterministic local/durable media path already delivered by M0-M3;
- YouTube as the first and only live publishing provider until VID-12 is verified;
- explicit human approval for every queued publish;
- no autonomous bulk publishing;
- no broad RAG/MCP automation in the write path;
- operator-visible queue/job state and existing backup/recovery guidance.

## Go / no-go checklist

A launch candidate is **GO** only when all items below are true:

- [ ] CI passes on the exact candidate commit/PR head.
- [ ] VID-12 real YouTube private upload + reconciliation is recorded as verified, or a deliberate waiver decision exists.
- [ ] Publish approval regression tests pass.
- [ ] Production/runtime configuration uses server-side credential storage and no secrets are committed.
- [ ] Backup/restore runbook has been reviewed for the selected deployment target.
- [ ] One operator knows how to inspect queue/job status, disconnect YouTube credentials, and stop publishing.

If any item is false, the code may remain deployable to a test environment but must not be treated as launch-ready production state.

## Immediately after launch

Prioritize M5 evidence before expanding scope: publish success/failure, provider latency, retry/dead-letter counts, transform duration and operational cost. Use that evidence to decide whether a second provider, more automation, or horizontal scaling is actually needed.
