import assert from 'node:assert/strict';
import { once } from 'node:events';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createAlphaAuthConfig } from '../auth.mjs';
import { assertSafeBind, createControlPlaneServer } from '../server.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const env = {
  VIDEOOS_WEB_ACCESS_CODE: 'alpha-access-code-1234',
  VIDEOOS_WEB_SESSION_SECRET: 'session-secret-that-is-distinct-and-long-enough-1234',
  VIDEOOS_WEB_SESSION_TTL_SECONDS: '300',
};

async function withProtectedServer(run) {
  let now = Date.parse('2026-09-17T01:00:00.000Z');
  const authConfig = createAlphaAuthConfig(env);
  const server = createControlPlaneServer({ repoRoot, authConfig, now: () => now });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    await run({ baseUrl: `http://127.0.0.1:${address.port}`, advance: (ms) => { now += ms; } });
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('protected mode fails closed on partial or weak configuration', () => {
  assert.throws(
    () => createAlphaAuthConfig({ VIDEOOS_WEB_ACCESS_CODE: 'only-one-secret' }),
    /requires both/,
  );
  assert.throws(
    () => createAlphaAuthConfig({ VIDEOOS_WEB_ACCESS_CODE: 'short', VIDEOOS_WEB_SESSION_SECRET: 'x'.repeat(40) }),
    /at least 12/,
  );
  assert.throws(
    () => createAlphaAuthConfig({ VIDEOOS_WEB_ACCESS_CODE: 'same-secret-value-that-is-long-enough', VIDEOOS_WEB_SESSION_SECRET: 'same-secret-value-that-is-long-enough' }),
    /must be distinct/,
  );
});

test('protected cockpit requires a valid signed HttpOnly session', async () => {
  await withProtectedServer(async ({ baseUrl, advance }) => {
    const anonymousShell = await fetch(`${baseUrl}/`, { redirect: 'manual' });
    assert.equal(anonymousShell.status, 302);
    assert.equal(anonymousShell.headers.get('location'), '/login.html');

    const anonymousState = await fetch(`${baseUrl}/api/launch-state`);
    assert.equal(anonymousState.status, 401);

    const invalid = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessCode: 'incorrect-value' }),
    });
    assert.equal(invalid.status, 401);
    assert.equal((await invalid.text()).includes(env.VIDEOOS_WEB_ACCESS_CODE), false);
    assert.equal((await fetch(`${baseUrl}/health`)).status, 200);

    const login = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessCode: env.VIDEOOS_WEB_ACCESS_CODE }),
    });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get('set-cookie');
    assert.ok(setCookie);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.equal(setCookie.includes(env.VIDEOOS_WEB_ACCESS_CODE), false);
    assert.equal(setCookie.includes(env.VIDEOOS_WEB_SESSION_SECRET), false);
    const cookie = setCookie.split(';', 1)[0];

    const authenticatedState = await fetch(`${baseUrl}/api/launch-state`, { headers: { cookie } });
    assert.equal(authenticatedState.status, 200);

    const tamperedCookie = `${cookie}x`;
    assert.equal((await fetch(`${baseUrl}/api/launch-state`, { headers: { cookie: tamperedCookie } })).status, 401);

    advance(301_000);
    assert.equal((await fetch(`${baseUrl}/api/launch-state`, { headers: { cookie } })).status, 401);
  });
});

test('login bodies are bounded and logout clears the alpha session', async () => {
  await withProtectedServer(async ({ baseUrl }) => {
    const oversized = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessCode: 'x'.repeat(5000) }),
    });
    assert.equal(oversized.status, 413);

    const logout = await fetch(`${baseUrl}/auth/logout`, { method: 'POST' });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie') ?? '', /Max-Age=0/);
  });
});

test('non-loopback standalone bind fails closed without auth unless the container override is explicit', () => {
  assert.doesNotThrow(() => assertSafeBind('127.0.0.1', null));
  assert.throws(() => assertSafeBind('0.0.0.0', null), /refusing unauthenticated non-loopback/);
  assert.doesNotThrow(() => assertSafeBind('0.0.0.0', createAlphaAuthConfig(env)));
  assert.doesNotThrow(() => assertSafeBind('0.0.0.0', null, true));
});
