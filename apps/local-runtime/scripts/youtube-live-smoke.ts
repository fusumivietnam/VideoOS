import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { PublishRequest, PublishTarget } from '@videoos/contracts';

import {
  JsonFileYouTubeOAuthCredentialStore,
  RefreshingYouTubeCredentialProvider,
} from '../src/youtube-credentials.js';
import {
  InMemoryYouTubeAttemptStore,
  NodeYouTubeResumableTransport,
  YouTubePublisherAdapter,
  type YouTubeAssetBodyLoader,
} from '../src/youtube-publisher.js';

async function main(): Promise<void> {
  requireOptIn();
  const projectId = required('VIDEOOS_PROJECT_ID');
  const accountId = required('VIDEOOS_YOUTUBE_ACCOUNT_ID');
  const filePath = required('VIDEOOS_YOUTUBE_SMOKE_FILE');
  const credentialsFile = required('VIDEOOS_YOUTUBE_CREDENTIALS_FILE');
  const channelId = process.env.VIDEOOS_YOUTUBE_CHANNEL_ID?.trim() || undefined;
  const mimeType = process.env.VIDEOOS_YOUTUBE_SMOKE_MIME?.trim() || 'video/mp4';
  const idempotencyKey = process.env.VIDEOOS_YOUTUBE_SMOKE_IDEMPOTENCY?.trim() || `manual-smoke-${Date.now()}`;

  const store = new JsonFileYouTubeOAuthCredentialStore(credentialsFile);
  const credentials = new RefreshingYouTubeCredentialProvider({ store });
  const loader: YouTubeAssetBodyLoader = {
    async load() {
      return new Uint8Array(await readFile(filePath));
    },
  };
  const transport = new NodeYouTubeResumableTransport(loader);
  const adapter = new YouTubePublisherAdapter({
    credentials,
    transport,
    attempts: new InMemoryYouTubeAttemptStore(),
  });

  const target: PublishTarget = {
    network: 'youtube',
    accountId,
    ...(channelId ? { channelId } : {}),
  };
  const request: PublishRequest = {
    idempotencyKey,
    projectId,
    targets: [target],
    assets: [{ assetId: 'manual-live-smoke', uri: `file://${filePath}`, mimeType }],
    caption: 'VideoOS manual live-provider verification. Safe to delete after validation.',
    metadata: {
      youtubeTitle: `VideoOS private smoke ${new Date().toISOString()}`,
      youtubePrivacyStatus: 'private',
    },
  };

  const receipts = await adapter.publish(request);
  const receipt = receipts[0];
  if (!receipt || receipt.status !== 'published' || !receipt.externalPostId) {
    throw new Error('YouTube smoke upload did not return a normalized published receipt');
  }

  const accessToken = await credentials.getAccessToken({ projectId, accountId });
  const reconciled = await transport.reconcile({
    accessToken,
    target,
    idempotencyMarker: markerFor(request, target),
  });
  if (!reconciled || reconciled.videoId !== receipt.externalPostId) {
    throw new Error('YouTube smoke reconciliation did not match the uploaded receipt');
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    privacyStatus: 'private',
    projectId,
    accountId,
    channelId: channelId ?? null,
    videoId: receipt.externalPostId,
    externalUrl: receipt.externalUrl ?? null,
    reconciled: true,
  }, null, 2)}\n`);
}

function markerFor(request: PublishRequest, target: PublishTarget): string {
  const key = ['youtube', request.projectId, target.accountId, target.channelId ?? '', request.idempotencyKey].join(':');
  return `videoos-${createHash('sha256').update(key).digest('hex').slice(0, 20)}`;
}

function requireOptIn(): void {
  if (process.env.VIDEOOS_YOUTUBE_LIVE_SMOKE !== '1') {
    throw new Error('Refusing live YouTube upload. Set VIDEOOS_YOUTUBE_LIVE_SMOKE=1 explicitly.');
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown YouTube live smoke failure';
  process.stderr.write(`YouTube live smoke failed: ${redact(message)}\n`);
  process.exitCode = 1;
});

function redact(value: string): string {
  const secrets = [
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REFRESH_TOKEN,
    process.env.GOOGLE_CLIENT_SECRET,
  ].filter((secret): secret is string => Boolean(secret && secret.length >= 4));
  return secrets.reduce((output, secret) => output.split(secret).join('[REDACTED]'), value).slice(0, 800);
}
