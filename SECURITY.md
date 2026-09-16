# Security policy

VideoOS is pre-1.0 and under active development. Security-sensitive boundaries include credentials, project authorization, worker/node execution, media process execution, publish adapters, storage/object access, and AI/provider integrations.

## Reporting a vulnerability

Do not open a public issue for a vulnerability that could expose credentials, private project data, remote execution capability, authorization bypasses, or other exploitable details.

Use GitHub's private vulnerability reporting / security advisory flow for this repository when available. Include a minimal reproduction, affected commit/version, impact, and any mitigation you have already tested. Do not include real production credentials or private user content.

For non-sensitive hardening ideas that do not disclose an exploitable weakness, use an Architecture / RFC issue.

## Security expectations

- Credentials never belong in public contracts, browser state, logs, fixtures, or committed environment files.
- Project authorization is server-side and deny-by-default.
- External side effects must be idempotent because queue delivery is at-least-once.
- Media/process executors must validate arguments, paths, resource limits, and timeouts.
- Durable state changes and transactional outbox writes should share a transaction where applicable.
- Dependencies and GitHub Actions should stay pinned/reviewed and receive routine security updates.
