import assert from 'node:assert/strict';
import test from 'node:test';

import type { PublishRequest } from '@videoos/contracts';
import {
  InMemoryYouTubeAttemptStore,
  YouTubePublishError,
  YouTubePublisherAdapter,
  YouTubeTransportError,
  YOUTUBE_CAPABILITIES,
  type YouTubeTransport,
} from '../src/youtube-publisher.js';

function request(overrides: Partial<PublishRequest> = {}): PublishRequest {
  return {
    idempotencyKey: 'publish:one',
    projectId: 'project:one',
    targets: [{ network: 'youtube', accountId: 'account:youtube', channelId: 'channel:one' }],
    assets: [{ assetId: 'asset:video', uri: 'object://video.mp4', mimeType: 'video/mp4', durationMs: 12_000 }],
    caption: 'Hello VideoOS',
    metadata: { youtubeTitle: 'VideoOS test', youtubePrivacyStatus: 'unlisted' },
    ...overrides,
  };
}

function credentials() {
  const calls: Array<{ projectId: string; accountId: string }> = [];
  return {
    calls,
    provider: {
      async getAccessToken(input: { projectId: string; accountId: string }) {
        calls.push(input);
        return 'server-only-token';
      },
    },
  };
}

test('YouTube capabilities stay explicit and provider-scoped', () => {
  assert.deepEqual(YOUTUBE_CAPABILITIES, {
    network: 'youtube', uploadVideo: true, scheduling: true, reconciliation: true,
    maxAssetsPerTarget: 1, credentialModel: 'oauth2-access-token',
  });
});

test('confirmed YouTube publish is replayed without duplicate remote upload', async () => {
  const auth = credentials();
  const attempts = new InMemoryYouTubeAttemptStore();
  let uploads = 0;
  const transport: YouTubeTransport = {
    async upload(input) {
      uploads += 1;
      assert.equal(input.accessToken, 'server-only-token');
      assert.equal(input.title, 'VideoOS test');
      assert.equal(input.privacyStatus, 'unlisted');
      assert.match(input.idempotencyMarker, /^videoos-/);
      return { videoId: 'yt-123' };
    },
  };
  const adapter = new YouTubePublisherAdapter({ credentials: auth.provider, transport, attempts });

  const first = await adapter.publish(request());
  const second = await adapter.publish(request());

  assert.equal(uploads, 1);
  assert.deepEqual(second, first);
  assert.equal(first[0]?.status, 'published');
  assert.equal(first[0]?.externalPostId, 'yt-123');
  assert.equal(auth.calls.length, 1);
});

test('unknown remote outcome blocks blind re-upload and can be resolved through reconciliation', async () => {
  const auth = credentials();
  const attempts = new InMemoryYouTubeAttemptStore();
  let uploads = 0;
  let reconciles = 0;
  const transport: YouTubeTransport = {
    async upload() {
      uploads += 1;
      throw new YouTubeTransportError('retryable', 'connection reset after body upload', 'unknown');
    },
    async reconcile(input) {
      reconciles += 1;
      assert.match(input.idempotencyMarker, /^videoos-/);
      return { videoId: 'yt-reconciled' };
    },
  };
  const adapter = new YouTubePublisherAdapter({ credentials: auth.provider, transport, attempts });

  await assert.rejects(() => adapter.publish(request()), (error: unknown) => {
    assert.ok(error instanceof YouTubePublishError);
    assert.equal(error.code, 'uncertain-outcome');
    return true;
  });
  const receipt = await adapter.publish(request());
  assert.equal(uploads, 1);
  assert.equal(reconciles, 1);
  assert.equal(receipt[0]?.externalPostId, 'yt-reconciled');
});

test('known not-created rate limit clears prepared journal so queue retry may safely reattempt', async () => {
  const auth = credentials();
  const attempts = new InMemoryYouTubeAttemptStore();
  let uploads = 0;
  const transport: YouTubeTransport = {
    async upload() {
      uploads += 1;
      if (uploads === 1) throw new YouTubeTransportError('rate-limited', 'quota window', 'not-created', 2_000);
      return { videoId: 'yt-after-retry' };
    },
  };
  const adapter = new YouTubePublisherAdapter({ credentials: auth.provider, transport, attempts });
  await assert.rejects(() => adapter.publish(request()), (error: unknown) => {
    assert.ok(error instanceof YouTubePublishError);
    assert.equal(error.code, 'rate-limited');
    assert.equal(error.retryAfterMs, 2_000);
    return true;
  });
  const receipt = await adapter.publish(request());
  assert.equal(uploads, 2);
  assert.equal(receipt[0]?.externalPostId, 'yt-after-retry');
});

test('idempotency key reuse with different content is rejected before another upload', async () => {
  const auth = credentials();
  const attempts = new InMemoryYouTubeAttemptStore();
  let uploads = 0;
  const adapter = new YouTubePublisherAdapter({
    credentials: auth.provider,
    attempts,
    transport: { async upload() { uploads += 1; return { videoId: 'yt-once' }; } },
  });
  await adapter.publish(request());
  await assert.rejects(
    () => adapter.publish(request({ caption: 'different content' })),
    /idempotency key was reused with different publish content/,
  );
  assert.equal(uploads, 1);
});

test('YouTube adapter rejects multi-asset requests before side effects', async () => {
  const auth = credentials();
  const adapter = new YouTubePublisherAdapter({
    credentials: auth.provider,
    attempts: new InMemoryYouTubeAttemptStore(),
    transport: { async upload() { throw new Error('should not execute'); } },
  });
  const input = request({ assets: [...request().assets, { assetId: 'asset:two', uri: 'object://two.mp4', mimeType: 'video/mp4' }] });
  await assert.rejects(() => adapter.publish(input), /exactly one video asset/);
  assert.equal(auth.calls.length, 0);
});
