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
    assets: [{ assetId: 'asset:video', uri: 'https://untrusted.invalid/video.mp4', mimeType: 'video/mp4' }],
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

test('YouTube capability matrix is explicit', () => {
  assert.deepEqual(YOUTUBE_CAPABILITIES, {
    network: 'youtube', uploadVideo: true, scheduling: true, reconciliation: true,
    maxAssetsPerTarget: 1, credentialModel: 'oauth2-access-token',
  });
});

test('confirmed publish replays without duplicate upload and rejects changed content', async () => {
  const auth = credentials();
  let uploads = 0;
  const adapter = new YouTubePublisherAdapter({
    credentials: auth.provider,
    attempts: new InMemoryYouTubeAttemptStore(),
    transport: {
      async upload(input) {
        uploads += 1;
        assert.equal(input.projectId, 'project:one');
        assert.equal(input.accessToken, 'server-only-token');
        assert.match(input.idempotencyMarker, /^videoos-/);
        return { videoId: 'yt-123' };
      },
    },
  });
  const first = await adapter.publish(request());
  assert.deepEqual(await adapter.publish(request()), first);
  assert.equal(uploads, 1);
  await assert.rejects(() => adapter.publish(request({ caption: 'different' })), /idempotency key was reused/);
  assert.equal(uploads, 1);
});

test('unknown outcome requires reconciliation instead of blind re-upload', async () => {
  const auth = credentials();
  let uploads = 0;
  let reconciles = 0;
  const transport: YouTubeTransport = {
    async upload() {
      uploads += 1;
      throw new YouTubeTransportError('retryable', 'connection reset', 'unknown');
    },
    async reconcile() {
      reconciles += 1;
      return { videoId: 'yt-reconciled' };
    },
  };
  const adapter = new YouTubePublisherAdapter({ credentials: auth.provider, transport, attempts: new InMemoryYouTubeAttemptStore() });
  await assert.rejects(() => adapter.publish(request()), (error: unknown) => error instanceof YouTubePublishError && error.code === 'uncertain-outcome');
  const receipt = await adapter.publish(request());
  assert.equal(uploads, 1);
  assert.equal(reconciles, 1);
  assert.equal(receipt[0]?.externalPostId, 'yt-reconciled');
});

test('known not-created rate limit permits one safe queue retry', async () => {
  const auth = credentials();
  let uploads = 0;
  const adapter = new YouTubePublisherAdapter({
    credentials: auth.provider,
    attempts: new InMemoryYouTubeAttemptStore(),
    transport: {
      async upload() {
        uploads += 1;
        if (uploads === 1) throw new YouTubeTransportError('rate-limited', 'quota window', 'not-created', 2_000);
        return { videoId: 'yt-after-retry' };
      },
    },
  });
  await assert.rejects(() => adapter.publish(request()), (error: unknown) =>
    error instanceof YouTubePublishError && error.code === 'rate-limited' && error.retryAfterMs === 2_000,
  );
  assert.equal((await adapter.publish(request()))[0]?.externalPostId, 'yt-after-retry');
  assert.equal(uploads, 2);
});

test('JSON-backed attempt store delegates durable get/put/delete', async () => {
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

test('trusted asset loader ignores external URI and reads project-scoped object bytes', async () => {
  const assets = new InMemoryAssetRepository();
  const objects = new InMemoryObjectStore();
  const key = 'projects/project:one/assets/asset:video/video.mp4';
  await assets.create({
    id: 'asset:video', projectId: 'project:one', kind: 'source-video', objectKey: key,
    contentType: 'video/mp4', bytes: 3, createdAt: '2026-09-16T00:00:00.000Z',
  });
  await objects.put({ key, contentType: 'video/mp4', body: new Uint8Array([1, 2, 3]) });
  const loader = new StoredYouTubeAssetBodyLoader(assets, objects);
  assert.deepEqual(await loader.load({ projectId: 'project:one', asset: request().assets[0]! }), new Uint8Array([1, 2, 3]));
  await assert.rejects(() => loader.load({ projectId: 'project:other', asset: request().assets[0]! }), /not found in project/);
});

test('resumable transport embeds marker and sends bounded trusted bytes', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const entry = init ? { url: String(input), init } : { url: String(input) };
    calls.push(entry);
    if (calls.length === 1) return new Response('', { status: 200, headers: { location: 'https://upload.example/session' } });
    return new Response(JSON.stringify({ id: 'yt-live' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const transport = new NodeYouTubeResumableTransport({ async load() { return new Uint8Array([1, 2, 3]); } }, fetchImpl);
  const result = await transport.upload({
    projectId: 'project:one', accessToken: 'token', asset: request().assets[0]!,
    title: 'Title', privacyStatus: 'private', idempotencyMarker: 'videoos-marker',
  });
  assert.equal(result.videoId, 'yt-live');
  const metadata = JSON.parse(String(calls[0]?.init?.body)) as { snippet: { tags: string[] } };
  assert.deepEqual(metadata.snippet.tags, ['videoos-marker']);
  assert.equal(new Headers(calls[1]?.init?.headers).get('content-range'), 'bytes 0-2/3');
});

test('reconciliation verifies exact marker tag and channel', async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/search?')) {
      return new Response(JSON.stringify({ items: [{ id: { videoId: 'candidate' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ items: [{ id: 'candidate', snippet: { channelId: 'channel:one', tags: ['videoos-marker'] } }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  const transport = new NodeYouTubeResumableTransport({ async load() { return new Uint8Array(); } }, fetchImpl);
  const result = await transport.reconcile({
    accessToken: 'token', target: { network: 'youtube', accountId: 'account:one', channelId: 'channel:one' }, idempotencyMarker: 'videoos-marker',
  });
  assert.equal(result?.videoId, 'candidate');
  assert.match(calls[0]!, /forMine=true/);
  assert.equal(calls.length, 2);
});
