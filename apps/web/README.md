# VideoOS Web

`apps/web` is the user/operator-facing control-plane surface. The eventual product UI will cover workspace/project/asset management, workflow visualization, publishing calendar/channel connections, analytics, AI recommendations, human approval checkpoints and product-facing observability.

## Current alpha scope

VID-14 intentionally starts with a dependency-free, read-only launch cockpit so the project can expose an operator surface before the full authenticated product UI is ready.

It currently provides:

- `GET /health` for web-shell liveness;
- `GET /api/launch-state`, derived only from canonical repository state/tasks;
- a browser dashboard for milestone/current focus and launch gates;
- exact non-secret operator commands for launch verification;
- localhost binding by default and restrictive browser headers;
- no publish, OAuth, repository mutation or provider-specific business logic.

The alpha shell deliberately has no `apps/web/package.json`. Root scripts run it directly with Node 24 so `pnpm install --frozen-lockfile` stays unchanged. When the authenticated product UI framework is pinned, `apps/web` can become a normal workspace package in a dedicated migration.

Run locally:

```bash
pnpm web:dev
```

Default URL:

```text
http://127.0.0.1:3000
```

Optional bind configuration:

```bash
VIDEOOS_WEB_HOST=127.0.0.1 VIDEOOS_WEB_PORT=3000 pnpm web:start
```

The alpha shell is not a substitute for the later authenticated product UI. It is deliberately read-only so it cannot bypass `VideoOsApi`, publish approval, authorization, queue, credential or provider boundaries.
