## Summary

Describe the user/system outcome and the smallest meaningful change that delivers it.

## Scope

- [ ] Core/domain contract
- [ ] Service/runtime
- [ ] Adapter/integration
- [ ] Infrastructure
- [ ] Documentation/governance

## Architecture and reliability

- Contract/API changes:
- Persistence/migration impact:
- External side effects and idempotency:
- Security/authorization impact:
- Rollback or compatibility notes:

## Verification

- [ ] `pnpm architecture:check`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] Relevant smoke/integration scenario

## GitHub Actions cost

- [ ] No new workflow/job added
- [ ] New workflow/job is justified below

If a new workflow/job is required, explain why the existing `CI / quality` job cannot cover it.

## Checklist

- [ ] Keeps provider-specific logic behind an adapter/port
- [ ] Does not expose credentials in contracts/browser state
- [ ] Updates docs/roadmap when milestone scope changes
- [ ] Adds tests for behavior or documents why none are needed
