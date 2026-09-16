# Controlled alpha deployment

This is the fastest supported way to run the current VideoOS launch cockpit as an internal/operator alpha. It packages only the read-only web shell and canonical repository state needed to calculate readiness.

It is **not** the future authenticated public product surface. Do not expose this container directly to the public internet. The default Compose binding is intentionally limited to `127.0.0.1:3000` on the host.

## Start

From the repository root:

```bash
pnpm alpha:up
```

Open:

```text
http://127.0.0.1:3000
```

Check the service directly:

```bash
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:3000/api/launch-state
```

Follow logs:

```bash
pnpm alpha:logs
```

Stop and remove the alpha container:

```bash
pnpm alpha:down
```

## Optional protected mode

For private/remote evaluation behind a trusted TLS/reverse-proxy boundary, enable the dependency-free alpha access gate with **two distinct server-side secrets**:

```bash
export VIDEOOS_WEB_ACCESS_CODE="use-a-long-random-access-code"
export VIDEOOS_WEB_SESSION_SECRET="use-a-different-random-session-secret-at-least-32-characters"
export VIDEOOS_WEB_COOKIE_SECURE=1
pnpm alpha:up
```

Protected mode exchanges the access code for a short-lived signed `HttpOnly; SameSite=Strict` cookie. The raw access code and HMAC session secret are not returned to the browser, stored in repository files, or written to application logs.

The access gate protects the cockpit and `/api/launch-state`; `/health` remains public for liveness checks. This is still a shared alpha access boundary, **not** the final project/user membership authentication system.

When running the standalone Node server outside Compose, binding a non-loopback address without protected mode fails closed. The alpha container uses `VIDEOOS_WEB_ALLOW_UNAUTHENTICATED_NON_LOOPBACK=1` only because the process must listen on the container interface while Compose publishes it exclusively to host `127.0.0.1:3000`. Do not copy that override into a public host bind.

## Container boundaries

The alpha image:

- uses Node 24 and installs no package dependencies;
- copies only `apps/web`, `.project/state.json`, and `backlog/tasks`;
- runs as the unprivileged `node` user;
- has an HTTP health check against `/health`;
- runs with a read-only root filesystem in Compose;
- uses `no-new-privileges`;
- exposes the service to the host only at `127.0.0.1:3000` by default;
- contains no OAuth credential file, provider token, database credential, media file, or mutable project state.

Because canonical state is baked into the image at build time, rebuild after merging roadmap/task/state changes:

```bash
pnpm alpha:up
```

Compose will rebuild the image before starting it.

## Publishing remains separately gated

The alpha cockpit does not run publishing or OAuth mutation commands. Before treating YouTube publishing as launch-verified, complete the VID-12 manual private-upload/reconciliation path on a trusted operator host using `docs/operations/youtube-oauth.md`.

The repository command:

```bash
pnpm launch:check
```

must remain authoritative. A red result is expected until the external live-provider evidence is recorded in canonical task state.

## Public exposure later

Before exposing a VideoOS web surface beyond controlled alpha access, add the project-scoped authenticated product surface and an explicit deployment boundary such as a reverse proxy or platform ingress with TLS, request limits, audit visibility, and environment-specific secret handling. The VID-16 shared access gate reduces accidental exposure risk but does not replace user identity, membership authorization, audit ownership, or tenant isolation.
