import assert from 'node:assert/strict';
import test from 'node:test';

import type { PublishRequest } from '@videoos/contracts';
import { InMemoryAssetRepository, InMemoryObjectStore } from '@videoos/storage';
import {
  InMemoryYouTubeAttemptStore,
  JsonBackedYouTubeAttemptStore,
  NodeYouTubeResumableTransport,
  StoredYouTubeAssetBodyLoader,
  YouTubePublishError,
  YouTubePublisherAdapter,
  YouTubeTransportError,
  YOUTUBE_CAPABILITIES,
  type JsonValueStore,
  type YouTubeAttemptState,
  type YouTubeTransport,
} from '../src/youtube-publisher.js';

function request(overrides: Partial<PublishRequest> = {}): PublishRequest {
  return {
    idempotencyKey: 'publish:one',
    projectId: 'project:one',
    targets: [{ network: 'youtube', accountId: 'account:youtube', channelId: 'channel:one' }],
    assets: [{ assetId: 'asset:video', uri: 'https://untrusted.invalid/video.mp4', mimeType: 'video/mp4', durationMs: 12_000 }],
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
      assert.equal(input.projectId, 'project:one');
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
  await assert.rejects(() => adapter.publish(request({ caption: 'different content' })), /idempotency key was reused with different publish content/);
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

test('JSON-backed attempt store delegates durable get/put/delete semantics', async () => {
  const values = new Map<string, YouTubeAttemptState>();
  const store: JsonValueStore<YouTubeAttemptState> = {
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); },
  };
  const attempts = new JsonBackedYouTubeAttemptStore(store);
  const state: YouTubeAttemptState = { status: 'prepared', fingerprint: 'fp', marker: 'marker' };
  await attempts.put('key', state);
  assert.deepEqual(await attempts.get('key'), state);
  await attempts.clear('key');
  assert.equal(await attempts.get('key'), undefined);
});

test('stored asset loader ignores untrusted URI and resolves project-scoped object bytes', async () => {
  const assets = new InMemoryAssetRepository();
  const objects = new InMemoryObjectStore();
  await assets.create({
    id: 'asset:video', projectId: 'project:one', kind: 'video',
    objectKey: 'projects/project:one/assets/asset:video/video.mp4', contentType: 'video/mp4', bytes: 3,
    createdAt: '2026-09-16T00:00:00.000Z',
  });
  await objects.put({ key: 'projects/project:one/assets/asset:video/video.mp4', contentType: 'video/mp4', body: new Uint8Array([1, 2, 3]) });
  const loader = new StoredYouTubeAssetBodyLoader(assets, objects);
  const body = await loader.load({ projectId: 'project:one', asset: request().assets[0]! });
  assert.deepEqual(body, new Uint8Array([1, 2, 3]));
  await assert.rejects(() => loader.load({ projectId: 'project:other', asset: request().assets[0]! }), /not found in project/);
});

test('resumable transport uploads trusted bytes and embeds deterministic marker tag', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (calls.length === 1) return new Response('', { status: 200, headers: { location: 'https://upload.example/session' } });
    return new Response(JSON.stringify({ id: 'yt-live' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const transport = new NodeYouTubeResumableTransport({ async load() { return new Uint8Array([1, 2, 3]); } }, fetchImpl);
  const result = await transport.upload({
    projectId: 'project:one', accessToken: 'token', asset: request().assets[0]!, title: 'Title', privacyStatus: 'private', idempotencyMarker: 'videoos-marker',
  });
  assert.equal(result.videoId, 'yt-live');
  assert.equal(calls.length, 2);
  const metadata = JSON.parse(String(calls[0]?.init?.body)) as { snippet: { tags: string[] } };
  assert.deepEqual(metadata.snippet.tags, ['videoos-marker']);
  assert.equal(calls[1]?.url, 'https://upload.example/session');
  assert.equal(new Headers(calls[1]?.init?.headers).get('content-range'), 'bytes 0-2/3');
});

test('transport reconciliation verifies exact marker tag and target channel before accepting search candidate', async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/search?')) {
      return new Response(JSON.stringify({ items: [{ id: { videoId: 'candidate' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      items: [{ id: 'candidate', snippet: { channelId: 'channel:one', tags: ['videoos-marker'] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const transport = new NodeYouTubeResumableTransport({ async load() { return new Uint8Array(); } }, fetchImpl);
  const result = await transport.reconcile({
    accessToken: 'token', target: { network: 'youtube', accountId: 'account:one', channelId: 'channel:one' }, idempotencyMarker: 'videoos-marker',
  });
  assert.equal(result?.videoId, 'candidate');
  assert.match(calls[0]!, /forMine=true/);
  assert.equal(calls.length, 2);
});
