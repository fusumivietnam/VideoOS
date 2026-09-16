import assert from 'node:assert/strict';
import { once } from 'node:events';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createControlPlaneServer, deriveLaunchState } from '../server.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function withServer(run) {
  const server = createControlPlaneServer({ repoRoot });
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
