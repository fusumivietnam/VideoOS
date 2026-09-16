# YouTube OAuth onboarding and live verification

This runbook is the operational path for `VID-12`. It keeps OAuth client secrets, refresh tokens and short-lived access tokens at the server/runtime edge. They must not be copied into publish payloads, browser state, repository files, GitHub Actions secrets, test fixtures or CI logs.

## Credential storage

For local/self-hosted operation, configure a credential JSON file **outside the repository checkout**:

```bash
export VIDEOOS_YOUTUBE_CREDENTIALS_FILE="$HOME/.config/videoos/youtube-credentials.json"
export VIDEOOS_PROJECT_ID="project-id"
export VIDEOOS_YOUTUBE_ACCOUNT_ID="youtube-account-id"
```

`JsonFileYouTubeOAuthCredentialStore` writes atomically and applies file mode `0600`. Treat the file as a secret-bearing runtime artifact and include it in the host's encrypted backup/secret-handling policy. A managed secret store may replace it later behind `YouTubeOAuthCredentialStore` without changing publisher contracts.

## OAuth client setup

Create an OAuth 2.0 client in the Google Cloud project that owns the YouTube Data API integration. Configure the exact redirect URI used by the server-side callback/onboarding flow.

VideoOS currently requests only:

- `https://www.googleapis.com/auth/youtube.upload`
- `https://www.googleapis.com/auth/youtube.readonly`

The upload scope permits managing uploads; readonly is used by authenticated reconciliation/read paths. Do not broaden scopes without a recorded decision and a concrete API need.

Set the server-shell values:

```bash
export VIDEOOS_YOUTUBE_CLIENT_ID="..."
export VIDEOOS_YOUTUBE_CLIENT_SECRET="..."
export VIDEOOS_YOUTUBE_REDIRECT_URI="http://127.0.0.1:8787/oauth/callback"
export VIDEOOS_YOUTUBE_OAUTH_STATE="$(openssl rand -hex 24)"
```

Generate the consent URL:

```bash
pnpm --filter @videoos/local-runtime youtube:credentials url
```

After Google redirects to the configured callback, verify the returned `state` in the onboarding surface before passing the authorization code to the server-side exchange. For the current manual path, set the verified code in the local server shell:

```bash
export VIDEOOS_YOUTUBE_AUTH_CODE="..."
pnpm --filter @videoos/local-runtime youtube:credentials connect
unset VIDEOOS_YOUTUBE_AUTH_CODE
```

The authorization-code exchange persists only the server-side credential record. Publish requests continue to carry only project/account identifiers.

## Rotation and disconnect

To replace an OAuth client/refresh token pair intentionally:

```bash
export VIDEOOS_YOUTUBE_REFRESH_TOKEN="..."
pnpm --filter @videoos/local-runtime youtube:credentials rotate
unset VIDEOOS_YOUTUBE_REFRESH_TOKEN
```

To disconnect the account and remove the credential record:

```bash
pnpm --filter @videoos/local-runtime youtube:credentials disconnect
```

After disconnect, `RefreshingYouTubeCredentialProvider` fails closed with `not-connected` for that project/account pair.

## Manual live-provider smoke

This path is deliberately opt-in and is **not part of normal CI**. Use a dedicated test channel and a disposable small video.

```bash
export VIDEOOS_YOUTUBE_LIVE_SMOKE=1
export VIDEOOS_YOUTUBE_SMOKE_FILE="/absolute/path/to/small-test.mp4"
export VIDEOOS_YOUTUBE_SMOKE_MIME="video/mp4"
export VIDEOOS_YOUTUBE_CHANNEL_ID="optional-expected-channel-id"

pnpm --filter @videoos/local-runtime youtube:live-smoke
```

The command:

1. loads the server-side OAuth record;
2. refreshes a short-lived access token when needed;
3. uploads the video with `privacyStatus=private` through the resumable transport;
4. requires a normalized `published` receipt with an external video ID;
5. performs authenticated reconciliation by the deterministic VideoOS idempotency marker;
6. fails unless the reconciled video ID exactly matches the upload receipt.

Record the smoke date, test channel, resulting video ID, operational constraints and any provider error category in the `VID-12` task before considering the live path verified. Do not record tokens or client secrets.

## Google/YouTube operational constraints

As of September 2026, Google's YouTube Data API documentation states that uploads made with `videos.insert` from unverified API projects created after 28 July 2020 are restricted to private viewing until the API project passes Google's audit. This aligns with the VideoOS smoke path, which always uploads privately.

Google's current server-side OAuth guidance describes authorization-code exchange yielding short-lived access tokens and refresh tokens, which is the model implemented by `RefreshingYouTubeCredentialProvider`. Public applications using user-data scopes may also be subject to Google's OAuth app verification requirements.

Keep the Google Cloud project, OAuth consent configuration, redirect URIs and test channel ownership documented operationally. Do not make live provider credentials a CI dependency.

## Failure diagnostics

Credential and token endpoint failures are normalized to bounded messages that include status/category but never provider response bodies, refresh tokens or client secrets. The live smoke command truncates its final diagnostic line and must not be changed to dump credential records or OAuth HTTP bodies.
