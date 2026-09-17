import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  clearSessionCookie,
  createAlphaAuthConfig,
  issueSession,
  readSessionCookie,
  sessionCookie,
  verifyAccessCode,
  verifySession,
} from './auth.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8', true]],
  ['/index.html', ['index.html', 'text/html; charset=utf-8', true]],
  ['/login.html', ['login.html', 'text/html; charset=utf-8', false]],
  ['/product.html', ['product.html', 'text/html; charset=utf-8', false]],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8', false]],
  ['/login.js', ['login.js', 'text/javascript; charset=utf-8', false]],
  ['/product.js', ['product.js', 'text/javascript; charset=utf-8', false]],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8', false]],
]);

const COMMON_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
const PRODUCT_PROXY_PREFIX = '/api/product/';
const MAX_PROXY_BODY_BYTES = 8 * 1024;

export function createControlPlaneServer(options = {}) {
  const repoRoot = options.repoRoot ?? resolve(here, '..', '..');
  const publicDir = options.publicDir ?? join(here, 'public');
  const authConfig = options.authConfig === undefined
    ? createAlphaAuthConfig(options.env ?? process.env)
    : options.authConfig;
  const now = options.now ?? Date.now;
  const productBffOrigin = normalizeProductBffOrigin(
    options.productBffOrigin === undefined ? options.env?.VIDEOOS_PRODUCT_BFF_ORIGIN ?? process.env.VIDEOOS_PRODUCT_BFF_ORIGIN : options.productBffOrigin,
  );

  return createServer(async (request, response) => {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const authenticated = !authConfig || verifySession(readSessionCookie(request.headers.cookie), authConfig, now());

    try {
      if (method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { status: 'ok', service: 'videoos-web' });
        return;
      }

      if (url.pathname.startsWith(PRODUCT_PROXY_PREFIX)) {
        if (!productBffOrigin) {
          sendJson(response, 503, { error: 'product_bff_unavailable' });
          return;
        }
        await proxyProductRequest(request, response, url, productBffOrigin);
        return;
      }

      if (method === 'GET' && url.pathname === '/api/session') {
        sendJson(response, 200, { protected: Boolean(authConfig), authenticated });
        return;
      }

      if (method === 'POST' && url.pathname === '/auth/login') {
        if (!authConfig) {
          sendJson(response, 404, { error: 'not_found' });
          return;
        }
        const body = await readBoundedJson(request, 4096);
        if (!verifyAccessCode(body?.accessCode, authConfig)) {
          sendJson(response, 401, { error: 'invalid_credentials' });
          return;
        }
        const token = issueSession(authConfig, now());
        sendJson(response, 200, { authenticated: true }, {
          'set-cookie': sessionCookie(token, authConfig),
        });
        return;
      }

      if (method === 'POST' && url.pathname === '/auth/logout') {
        if (!authConfig) {
          sendJson(response, 404, { error: 'not_found' });
          return;
        }
        sendJson(response, 200, { authenticated: false }, {
          'set-cookie': clearSessionCookie(authConfig),
        });
        return;
      }

      if (method === 'GET' && url.pathname === '/api/launch-state') {
        if (!authenticated) {
          sendJson(response, 401, { error: 'authentication_required' });
          return;
        }
        const state = await deriveLaunchState(repoRoot);
        sendJson(response, 200, state, { 'cache-control': 'no-store' });
        return;
      }

      if (method === 'GET' && STATIC_FILES.has(url.pathname)) {
        const [fileName, contentType, requiresAuth] = STATIC_FILES.get(url.pathname);
        if (requiresAuth && !authenticated) {
          response.writeHead(302, {
            ...COMMON_HEADERS,
            location: '/login.html',
            'cache-control': 'no-store',
          });
          response.end();
          return;
        }
        const body = await readFile(join(publicDir, fileName));
        response.writeHead(200, {
          ...COMMON_HEADERS,
          'content-type': contentType,
          'cache-control': 'no-store',
        });
        response.end(body);
        return;
      }

      sendJson(response, 404, { error: 'not_found' });
    } catch (error) {
      if (error instanceof RequestBodyError) {
        sendJson(response, error.status, { error: error.code });
        return;
      }
      sendJson(response, 500, {
        error: 'control_plane_failed',
        message: bounded(error instanceof Error ? error.message : String(error)),
      });
    }
  });
}

async function proxyProductRequest(request, response, url, productBffOrigin) {
  const target = new URL(`${url.pathname}${url.search}`, productBffOrigin);
  const headers = new Headers();
  if (request.headers.cookie) headers.set('cookie', request.headers.cookie);
  const contentType = request.headers['content-type'];
  if (typeof contentType === 'string') headers.set('content-type', contentType);

  const body = request.method === 'GET' || request.method === 'HEAD'
    ? undefined
    : await readBoundedBody(request, MAX_PROXY_BODY_BYTES);

  const upstream = await fetch(target, {
    method: request.method ?? 'GET',
    headers,
    body,
    redirect: 'manual',
  });

  const responseHeaders = {
    ...COMMON_HEADERS,
    'cache-control': 'no-store',
  };
  const upstreamContentType = upstream.headers.get('content-type');
  if (upstreamContentType) responseHeaders['content-type'] = upstreamContentType;
  const setCookie = upstream.headers.get('set-cookie');
  if (setCookie) responseHeaders['set-cookie'] = setCookie;

  response.writeHead(upstream.status, responseHeaders);
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

function normalizeProductBffOrigin(value) {
  if (!value) return null;
  const origin = new URL(value);
  if (origin.protocol !== 'http:' && origin.protocol !== 'https:') throw new Error('VIDEOOS_PRODUCT_BFF_ORIGIN must use http or https');
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('VIDEOOS_PRODUCT_BFF_ORIGIN must be a bare origin');
  }
  return origin.origin;
}

async function readBoundedBody(request, maxBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) throw new RequestBodyError(413, 'request_too_large');
    chunks.push(buffer);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

export async function deriveLaunchState(repoRoot) {
  const state = JSON.parse(await readFile(join(repoRoot, '.project', 'state.json'), 'utf8'));
  const taskDir = join(repoRoot, 'backlog', 'tasks');
  const taskNames = await readdir(taskDir);
  const vid12Path = findTask(taskNames, 'vid-12 ');
  const vid13Path = findTask(taskNames, 'vid-13 ');
  const vid12 = await readFile(join(taskDir, vid12Path), 'utf8');
  const vid13 = await readFile(join(taskDir, vid13Path), 'utf8');

  const gates = [
    {
      id: 'youtube-live-verification',
      label: 'YouTube live private upload + reconciliation',
      ok: checkboxDone(vid12, 3),
      detail: checkboxDone(vid12, 3) ? 'VID-12 #3 verified' : 'VID-12 #3 pending manual smoke',
    },
    {
      id: 'second-provider-lock',
      label: 'Second provider gate recorded',
      ok: checkboxDone(vid12, 7),
      detail: checkboxDone(vid12, 7) ? 'VID-12 #7 complete' : 'Second provider remains locked',
    },
    {
      id: 'publish-safety',
      label: 'Explicit publish approval + launch safety',
      ok: taskStatus(vid13) === 'Done',
      detail: `VID-13 status=${taskStatus(vid13) ?? 'unknown'}`,
    },
  ];

  const ready = gates.every((gate) => gate.ok);
  return {
    ready,
    project: state.project,
    milestone: state.milestone,
    milestoneName: state.milestoneName,
    updatedAt: state.updatedAt,
    currentFocus: Array.isArray(state.currentFocus) ? state.currentFocus : [],
    gates,
    commands: [
      'pnpm launch:check',
      'pnpm --filter @videoos/local-runtime youtube:credentials url',
      'VIDEOOS_YOUTUBE_LIVE_SMOKE=1 pnpm --filter @videoos/local-runtime youtube:live-smoke',
    ],
    mode: 'read-only-alpha',
  };
}

export function assertSafeBind(host, authConfig, allowUnauthenticatedNonLoopback = false) {
  if (isLoopbackHost(host) || authConfig || allowUnauthenticatedNonLoopback) return;
  throw new Error('refusing unauthenticated non-loopback web bind; enable protected mode or explicitly allow the container-local bind');
}

function findTask(taskNames, prefix) {
  const match = taskNames.find((name) => name.toLowerCase().startsWith(prefix));
  if (!match) throw new Error(`canonical task missing: ${prefix.trim()}`);
  return match;
}

function checkboxDone(markdown, number) {
  return new RegExp(`^- \\[x\\] #${number} `, 'm').test(markdown);
}

function taskStatus(markdown) {
  return markdown.match(/^status:\s*(.+)$/m)?.[1]?.trim();
}

async function readBoundedJson(request, maxBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new RequestBodyError(413, 'request_too_large');
    chunks.push(chunk);
  }
  if (!chunks.length) throw new RequestBodyError(400, 'invalid_json');
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    return parsed;
  } catch {
    throw new RequestBodyError(400, 'invalid_json');
  }
}

function sendJson(response, status, value, extraHeaders = {}) {
  response.writeHead(status, {
    ...COMMON_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

function bounded(value) {
  return value.replace(/[\r\n]+/g, ' ').slice(0, 400);
}

function isLoopbackHost(host) {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

class RequestBodyError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const executedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executedDirectly) {
  const host = process.env.VIDEOOS_WEB_HOST?.trim() || '127.0.0.1';
  const port = parsePort(process.env.VIDEOOS_WEB_PORT);
  const authConfig = createAlphaAuthConfig(process.env);
  assertSafeBind(host, authConfig, process.env.VIDEOOS_WEB_ALLOW_UNAUTHENTICATED_NON_LOOPBACK === '1');
  const server = createControlPlaneServer({ authConfig, env: process.env });
  server.listen(port, host, () => {
    process.stdout.write(`VideoOS control plane listening on http://${host}:${port}${authConfig ? ' (protected)' : ' (localhost alpha)'}\n`);
  });
}

function parsePort(value) {
  if (!value) return 3000;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('VIDEOOS_WEB_PORT must be an integer between 1 and 65535');
  return port;
}
