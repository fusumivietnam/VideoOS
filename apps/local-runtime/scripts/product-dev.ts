import { once } from 'node:events';

import { createInMemoryRuntime } from '../src/index.js';
import { composePublisherAdapters } from '../src/publisher-composition.js';
import { createProductBffServer } from '../src/product-bff.js';
import { loadRuntimeConfig } from '../src/runtime-config.js';
import type { ProductAuthConfig } from '../src/product-auth.js';

const config = loadRuntimeConfig({ ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'development' });
if (config.mode === 'production') throw new Error('product:dev refuses NODE_ENV=production');
if (config.publisher.driver !== 'fake') throw new Error('product:dev requires VIDEOOS_PUBLISHER_DRIVER=fake');
if (!['127.0.0.1', 'localhost', '::1'].includes(config.productBff.host)) {
  throw new Error('product:dev refuses non-loopback BFF host');
}

const principal = { id: 'user:demo', kind: 'user' as const };
const accessCode = process.env.VIDEOOS_MVP_ACCESS_CODE?.trim() || 'videoos-local-demo';
const auth: ProductAuthConfig = {
  identities: [{ principalId: principal.id, accessCode }],
  sessionSecret: process.env.VIDEOOS_MVP_SESSION_SECRET?.trim() || 'videoos-local-demo-session-secret-change-me-2026',
  ttlSeconds: 8 * 60 * 60,
  secureCookie: false,
};

const runtime = createInMemoryRuntime({
  memberships: [{ projectId: 'project:demo', principalId: principal.id, role: 'owner' }],
  mediaExecutor: {
    async execute(_request, context) {
      return { assetId: `${context.jobId}:output`, uri: `memory://${context.jobId}.mp4` };
    },
  },
  publisherAdapters: composePublisherAdapters(config),
  workerId: 'videoos-mvp-ui',
});

await runtime.assets.create({
  id: 'asset:demo-video',
  projectId: 'project:demo',
  kind: 'source-video',
  objectKey: 'demo/video.mp4',
  contentType: 'video/mp4',
  bytes: 12_345_678,
  createdAt: new Date().toISOString(),
});

const server = createProductBffServer(runtime.api, auth, {
  publisherDriver: config.publisher.driver,
  runPublishOnce: () => runtime.runPublishOnce(),
});
server.listen(config.productBff.port, config.productBff.host);
await once(server, 'listening');

let mediaWorkerBusy = false;
const mediaTimer = setInterval(async () => {
  if (mediaWorkerBusy) return;
  mediaWorkerBusy = true;
  try {
    await runtime.runMediaOnce();
  } catch (error) {
    process.stderr.write(`VideoOS MVP media worker error: ${bounded(error)}\n`);
  } finally {
    mediaWorkerBusy = false;
  }
}, 300);
mediaTimer.unref();

process.stdout.write([
  `VideoOS MVP product BFF listening on http://${config.productBff.host}:${config.productBff.port}`,
  'Demo principal: user:demo',
  'Demo project: project:demo',
  `Demo access code: ${accessCode}`,
  'Publisher: fake (no external provider side effect)',
  '',
].join('\n'));

const shutdown = async () => {
  clearInterval(mediaTimer);
  server.close();
  await once(server, 'close').catch(() => undefined);
};

process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));

function bounded(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value.replace(/[\r\n]+/g, ' ').slice(0, 300);
}
