import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

const COMMON_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

export function createControlPlaneServer(options = {}) {
  const repoRoot = options.repoRoot ?? resolve(here, '..', '..');
  const publicDir = options.publicDir ?? join(here, 'public');

  return createServer(async (request, response) => {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');

    try {
      if (method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { status: 'ok', service: 'videoos-web' });
        return;
      }

      if (method === 'GET' && url.pathname === '/api/launch-state') {
        const state = await deriveLaunchState(repoRoot);
        sendJson(response, 200, state, { 'cache-control': 'no-store' });
        return;
      }

      if (method === 'GET' && STATIC_FILES.has(url.pathname)) {
        const [fileName, contentType] = STATIC_FILES.get(url.pathname);
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
      sendJson(response, 500, {
        error: 'control_plane_failed',
        message: bounded(error instanceof Error ? error.message : String(error)),
      });
    }
  });
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

const executedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executedDirectly) {
  const host = process.env.VIDEOOS_WEB_HOST?.trim() || '127.0.0.1';
  const port = parsePort(process.env.VIDEOOS_WEB_PORT);
  const server = createControlPlaneServer();
  server.listen(port, host, () => {
    process.stdout.write(`VideoOS control plane listening on http://${host}:${port}\n`);
  });
}

function parsePort(value) {
  if (!value) return 3000;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('VIDEOOS_WEB_PORT must be an integer between 1 and 65535');
  return port;
}
