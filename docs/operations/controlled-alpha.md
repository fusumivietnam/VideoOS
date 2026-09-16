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

Before exposing a VideoOS web surface beyond localhost/private operator access, add the authenticated product surface and an explicit deployment boundary such as an authenticated reverse proxy or platform ingress with TLS, request limits, audit visibility, and environment-specific secret handling. Do not weaken the current localhost binding simply to make the alpha reachable from the internet.
