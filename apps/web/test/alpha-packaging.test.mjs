import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function text(relativePath) {
  return readFile(resolve(repoRoot, relativePath), 'utf8');
}

test('alpha Dockerfile stays dependency-free, unprivileged and health-checked', async () => {
  const dockerfile = await text('apps/web/Dockerfile');
  assert.match(dockerfile, /^FROM node:24\./m);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^HEALTHCHECK /m);
  assert.match(dockerfile, /127\.0\.0\.1:3000\/health/);
  assert.equal(/\b(?:npm|pnpm|yarn)\s+(?:install|ci)\b/.test(dockerfile), false);
  assert.match(dockerfile, /COPY --chown=node:node \.project\/state\.json/);
  assert.match(dockerfile, /COPY --chown=node:node backlog\/tasks/);
});

test('alpha Compose publishes only to localhost and applies read-only process boundaries', async () => {
  const compose = await text('infra/compose.alpha.yml');
  assert.match(compose, /127\.0\.0\.1:3000:3000/);
  assert.match(compose, /read_only:\s*true/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /VIDEOOS_WEB_ALLOW_UNAUTHENTICATED_NON_LOOPBACK:\s*1/);
  assert.equal(/0\.0\.0\.0:3000:3000/.test(compose), false);
});

test('controlled alpha runbook explicitly rejects direct public exposure', async () => {
  const runbook = await text('docs/operations/controlled-alpha.md');
  assert.match(runbook, /not.*public product surface/i);
  assert.match(runbook, /Do not expose.*public internet/i);
  assert.match(runbook, /pnpm launch:check/);
  assert.match(runbook, /VIDEOOS_WEB_ACCESS_CODE/);
  assert.match(runbook, /VIDEOOS_WEB_SESSION_SECRET/);
});
