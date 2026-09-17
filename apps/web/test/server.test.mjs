import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createControlPlaneServer, deriveLaunchState } from '../server.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function withServer(run, options = {}) {
  const server = createControlPlaneServer({ repoRoot, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

async function withUpstream(run) {
  const upstream = createServer(async (request, response) => {
    const body = [];
    for await (const chunk of request) body.push(Buffer.from(chunk));
    if (request.url === '/api/product/session' && request.method === 'POST') {
      response.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': 'videoos_product_session=abc; Path=/; HttpOnly; SameSite=Strict',
      });
      response.end(JSON.stringify({ authenticated: true, received: Buffer.concat(body).toString('utf8') }));
      return;
    }
    if (request.url === '/api/product/me/projects') {
      if (!request.headers.cookie?.includes('videoos_product_session=abc')) {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'authentication_required' }));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ principalId: 'user:a', projects: [{ projectId: 'project:a', role: 'owner' }] }));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found' }));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const address = upstream.address();
  assert.ok(address && typeof address === 'object');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    upstream.close();
    await once(upstream, 'close');
  }
}

test('health endpoint is local control-plane liveness only', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', service: 'videoos-web' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
});

test('launch state is derived from canonical repository files and remains read-only', async () => {
  const state = await deriveLaunchState(repoRoot);
  assert.equal(state.project, 'VideoOS');
  assert.equal(state.mode, 'read-only-alpha');
  assert.ok(Array.isArray(state.currentFocus));
  assert.ok(state.gates.some((gate) => gate.id === 'youtube-live-verification'));
  assert.ok(state.gates.some((gate) => gate.id === 'publish-safety'));

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/launch-state`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.project, 'VideoOS');
    assert.equal(payload.mode, 'read-only-alpha');
    assert.equal(response.headers.get('cache-control'), 'no-store');

    const mutation = await fetch(`${baseUrl}/api/launch-state`, { method: 'POST' });
    assert.equal(mutation.status, 404);
  });
});

test('static shell is allowlisted and served with restrictive browser headers', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Launch control plane/);
    assert.match(html, /read-only alpha/);
    assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'self'/);

    const traversal = await fetch(`${baseUrl}/../package.json`);
    assert.equal(traversal.status, 404);
  });
});

test('product UI is served without exposing a direct database or service origin', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/product.html`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Your projects/);
    assert.match(html, /product\.js/);
    assert.doesNotMatch(html, /DATABASE_URL|postgres:\/\//i);
  });
});

test('product proxy fails closed when no BFF origin is configured', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/product/me/projects`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'product_bff_unavailable' });
  });
});

test('same-origin product proxy preserves auth cookie, body and upstream status', async () => {
  await withUpstream(async (productBffOrigin) => {
    await withServer(async (baseUrl) => {
      const login = await fetch(`${baseUrl}/api/product/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accessCode: 'alpha-user-a-secret' }),
      });
      assert.equal(login.status, 200);
      assert.match(login.headers.get('set-cookie') ?? '', /videoos_product_session=abc/);
      const loginPayload = await login.json();
      assert.equal(loginPayload.received, JSON.stringify({ accessCode: 'alpha-user-a-secret' }));

      const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
      assert.ok(cookie);
      const projects = await fetch(`${baseUrl}/api/product/me/projects`, { headers: { cookie } });
      assert.equal(projects.status, 200);
      assert.deepEqual(await projects.json(), {
        principalId: 'user:a',
        projects: [{ projectId: 'project:a', role: 'owner' }],
      });
    }, { productBffOrigin });
  });
});
