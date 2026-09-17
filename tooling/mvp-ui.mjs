import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = {
  ...process.env,
  NODE_ENV: 'development',
  VIDEOOS_PUBLISHER_DRIVER: 'fake',
  VIDEOOS_WEB_HOST: process.env.VIDEOOS_WEB_HOST || '127.0.0.1',
  VIDEOOS_WEB_PORT: process.env.VIDEOOS_WEB_PORT || '3000',
  VIDEOOS_PRODUCT_BFF_HOST: process.env.VIDEOOS_PRODUCT_BFF_HOST || '127.0.0.1',
  VIDEOOS_PRODUCT_BFF_PORT: process.env.VIDEOOS_PRODUCT_BFF_PORT || '3001',
};
env.VIDEOOS_PRODUCT_BFF_ORIGIN = `http://${env.VIDEOOS_PRODUCT_BFF_HOST}:${env.VIDEOOS_PRODUCT_BFF_PORT}`;

const children = [];

function start(command, args, name, childEnv = env) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: childEnv,
    stdio: 'inherit',
    shell: false,
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    process.stderr.write(`${name} exited unexpectedly (${signal ?? code ?? 'unknown'}).\n`);
    void shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
start(pnpmCommand, ['--filter', '@videoos/local-runtime', 'product:dev'], 'product-bff');
start(process.execPath, ['apps/web/server.mjs'], 'web');

process.stdout.write([
  '',
  `VideoOS MVP UI: http://${env.VIDEOOS_WEB_HOST}:${env.VIDEOOS_WEB_PORT}/product.html`,
  `Demo access code: ${env.VIDEOOS_MVP_ACCESS_CODE || 'videoos-local-demo'}`,
  'Mode: local fake publisher; no external provider side effects.',
  'Press Ctrl+C to stop both processes.',
  '',
].join('\n'));

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  await Promise.all(children.map((child) => new Promise((resolveChild) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolveChild();
    child.once('exit', resolveChild);
    setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
      resolveChild();
    }, 2_000).unref();
  })));
  process.exit(exitCode);
}

process.once('SIGINT', () => void shutdown(0));
process.once('SIGTERM', () => void shutdown(0));
