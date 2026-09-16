import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InMemoryYouTubeOAuthCredentialStore,
  RefreshingYouTubeCredentialProvider,
  YouTubeCredentialManager,
  YouTubeCredentialError,
} from '../src/youtube-credentials.js';

const PROJECT = 'project-1';
const ACCOUNT = 'youtube-account-1';

test('refreshing provider keeps refresh/client credentials server-side and caches access tokens', async () => {
  const store = new InMemoryYouTubeOAuthCredentialStore();
  await store.put({
    projectId: PROJECT,
    accountId: ACCOUNT,
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z',
  });

  const calls: Array<{ url: string; body: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), body: String(init?.body ?? '') });
    return new Response(JSON.stringify({ access_token: 'short-lived-access-token', expires_in: 3600 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const provider = new RefreshingYouTubeCredentialProvider({ store, fetchImpl, now: () => 1_000 });

  assert.equal(await provider.getAccessToken({ projectId: PROJECT, accountId: ACCOUNT }), 'short-lived-access-token');
  assert.equal(await provider.getAccessToken({ projectId: PROJECT, accountId: ACCOUNT }), 'short-lived-access-token');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://oauth2.googleapis.com/token');
  assert.match(calls[0]?.body ?? '', /grant_type=refresh_token/);
  assert.match(calls[0]?.body ?? '', /refresh_token=refresh-token/);
});

test('credential manager connects, rotates and disconnects project/account-scoped credentials', async () => {
  const store = new InMemoryYouTubeOAuthCredentialStore();
  const manager = new YouTubeCredentialManager({
    store,
    now: () => new Date('2026-09-17T01:00:00.000Z'),
    fetchImpl: async () => new Response(JSON.stringify({ refresh_token: 'refresh-from-code' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });

  await manager.connectWithAuthorizationCode({
    projectId: PROJECT,
    accountId: ACCOUNT,
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'http://127.0.0.1:8787/oauth/callback',
    code: 'authorization-code',
  });

  const connected = await store.get({ projectId: PROJECT, accountId: ACCOUNT });
  assert.equal(connected?.refreshToken, 'refresh-from-code');
  assert.equal(connected?.createdAt, '2026-09-17T01:00:00.000Z');

  await manager.rotate({
    projectId: PROJECT,
    accountId: ACCOUNT,
    clientId: 'client-id-2',
    clientSecret: 'client-secret-2',
    refreshToken: 'refresh-token-2',
  });
  const rotated = await store.get({ projectId: PROJECT, accountId: ACCOUNT });
  assert.equal(rotated?.clientId, 'client-id-2');
  assert.equal(rotated?.refreshToken, 'refresh-token-2');
  assert.equal(rotated?.createdAt, connected?.createdAt);

  await manager.disconnect({ projectId: PROJECT, accountId: ACCOUNT });
  assert.equal(await store.get({ projectId: PROJECT, accountId: ACCOUNT }), undefined);
});

test('authorization URL requests offline consent and bounded YouTube scopes', () => {
  const manager = new YouTubeCredentialManager({ store: new InMemoryYouTubeOAuthCredentialStore() });
  const url = new URL(manager.authorizationUrl({
    clientId: 'client-id',
    clientSecret: 'not-in-url',
    redirectUri: 'http://127.0.0.1:8787/oauth/callback',
    state: 'csrf-state',
  }));

  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('state'), 'csrf-state');
  assert.equal(url.toString().includes('not-in-url'), false);
  assert.match(url.searchParams.get('scope') ?? '', /youtube\.upload/);
  assert.match(url.searchParams.get('scope') ?? '', /youtube\.readonly/);
});

test('provider diagnostics do not include refresh tokens or client secrets', async () => {
  const store = new InMemoryYouTubeOAuthCredentialStore();
  await store.put({
    projectId: PROJECT,
    accountId: ACCOUNT,
    clientId: 'client-id',
    clientSecret: 'VERY-SECRET-CLIENT',
    refreshToken: 'VERY-SECRET-REFRESH',
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z',
  });
  const provider = new RefreshingYouTubeCredentialProvider({
    store,
    fetchImpl: async () => new Response('provider body could contain sensitive diagnostics', { status: 401 }),
  });

  await assert.rejects(
    () => provider.getAccessToken({ projectId: PROJECT, accountId: ACCOUNT }),
    (error: unknown) => {
      assert.ok(error instanceof YouTubeCredentialError);
      assert.equal(error.message.includes('VERY-SECRET-CLIENT'), false);
      assert.equal(error.message.includes('VERY-SECRET-REFRESH'), false);
      assert.equal(error.message, 'YouTube OAuth token request failed with status 401');
      return true;
    },
  );
});
