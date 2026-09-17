# Runtime configuration boundary

VideoOS runtime configuration is parsed at the composition root before services/adapters are created. Domain services and provider adapters should receive typed values/dependencies rather than reading environment variables ad hoc.

## Current canonical runtime keys

| Environment key | Type | Default | Class | Notes |
| --- | --- | --- | --- | --- |
| `NODE_ENV` | `development \| test \| production` | `development` | deployment | Unknown values fail startup. |
| `VIDEOOS_WEB_HOST` | host | `127.0.0.1` | deployment | No URL/path syntax. |
| `VIDEOOS_WEB_PORT` | port | `3000` | deployment | 1..65535. |
| `VIDEOOS_PRODUCT_BFF_HOST` | host | `127.0.0.1` | deployment | Internal BFF bind host. |
| `VIDEOOS_PRODUCT_BFF_PORT` | port | `3001` | deployment | 1..65535. |
| `VIDEOOS_PUBLISHER_DRIVER` | `fake \| youtube` | fake outside production; youtube in production | application | `fake` is local/test only. |

Provider credentials such as YouTube client secrets and refresh tokens remain in the provider-specific credential boundary and are not copied into this generic runtime config object.

## Publisher composition

- `development` / `test` default to the deterministic fake YouTube publisher. This enables the full API -> approval -> publish queue -> worker -> terminal job loop without external credentials.
- `production` defaults to the YouTube driver and fails closed unless a real YouTube adapter is explicitly supplied by the composition root.
- There is no production fallback from YouTube to fake publishing.

## Configuration classes

1. **Deployment config**: bind hosts, ports, endpoints and runtime mode.
2. **Secret config**: credentials/tokens/passwords, kept in provider/secret boundaries and injected server-side.
3. **Application config**: adapter selection and operational limits.
4. **Product policy**: permissions, approval and publishing rules. These belong to domain/policy state, not environment variables.

## Extraction path

The typed parser currently lives in `apps/local-runtime/src/runtime-config.ts` to avoid adding workspace/lockfile churn during MVP completion. Once the runtime surface stabilizes, move it unchanged behind `@videoos/config`; do not create a second parser or rename variables during extraction.
