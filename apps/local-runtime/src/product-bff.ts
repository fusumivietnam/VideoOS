import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Principal } from '@videoos/identity';
import type { VideoOsApi } from '../../../services/api/src/index.js';
import {
  authenticateAccessCode,
  clearProductSessionCookie,
  issueProductSession,
  productSessionCookie,
  readProductSessionCookie,
  type ProductAuthConfig,
  verifyProductSession,
} from './product-auth.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};
const MAX_BODY_BYTES = 4 * 1024;
const MAX_PATH_ID_LENGTH = 256;

export function createProductBffServer(api: VideoOsApi, auth: ProductAuthConfig) {
  return createServer(async (request, response) => {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');

    try {
      if (method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { status: 'ok', service: 'videoos-product-bff' });
        return;
      }

      if (method === 'POST' && url.pathname === '/api/product/session') {
        const body = await readJsonBody(request);
        const principalId = authenticateAccessCode(body.accessCode, auth);
        if (!principalId) {
          sendJson(response, 401, { error: 'invalid_credentials' });
          return;
        }
        const token = issueProductSession(principalId, auth);
        sendJson(response, 200, { authenticated: true }, { 'set-cookie': productSessionCookie(token, auth) });
        return;
      }

      if (method === 'DELETE' && url.pathname === '/api/product/session') {
        sendJson(response, 200, { authenticated: false }, { 'set-cookie': clearProductSessionCookie(auth) });
        return;
      }

      if (!url.pathname.startsWith('/api/product/')) {
        sendJson(response, 404, { error: 'not_found' });
        return;
      }

      const principal = authenticatedPrincipal(request, auth);
      if (!principal) {
        sendJson(response, 401, { error: 'authentication_required' });
        return;
      }

      if (method === 'GET' && url.pathname === '/api/product/me/projects') {
        sendJson(response, 200, { principalId: principal.id, projects: await api.listProjects(principal) });
        return;
      }

      const assetsMatch = url.pathname.match(/^\/api\/product\/projects\/([^/]+)\/assets$/);
      if (method === 'GET' && assetsMatch?.[1]) {
        const projectId = decodeBoundedId(assetsMatch[1]);
        sendJson(response, 200, { projectId, assets: await api.listAssets(principal, projectId) });
        return;
      }

      const jobMatch = url.pathname.match(/^\/api\/product\/projects\/([^/]+)\/jobs\/([^/]+)$/);
      if (method === 'GET' && jobMatch?.[1] && jobMatch?.[2]) {
        const projectId = decodeBoundedId(jobMatch[1]);
        const jobId = decodeBoundedId(jobMatch[2]);
        sendJson(response, 200, { projectId, job: await api.getJobStatus(principal, projectId, jobId) });
        return;
      }

      sendJson(response, 404, { error: 'not_found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'project membership required' || message.startsWith('capability denied:')) {
        sendJson(response, 403, { error: 'forbidden' });
        return;
      }
      if (message === 'request body too large' || message === 'invalid json body' || message === 'invalid path identifier') {
        sendJson(response, 400, { error: 'bad_request' });
        return;
      }
      sendJson(response, 500, { error: 'product_bff_failed' });
    }
  });
}

function authenticatedPrincipal(request: IncomingMessage, auth: ProductAuthConfig): Principal | null {
  const token = readProductSessionCookie(request.headers.cookie);
  const principalId = verifyProductSession(token, auth);
  return principalId ? { id: principalId, kind: 'user' } : null;
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(buffer);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('invalid json body');
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid json body') throw error;
    throw new Error('invalid json body');
  }
}

function decodeBoundedId(raw: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new Error('invalid path identifier');
  }
  if (!decoded || decoded.length > MAX_PATH_ID_LENGTH || decoded.includes('/') || decoded.includes('\\')) {
    throw new Error('invalid path identifier');
  }
  return decoded;
}

function sendJson(response: ServerResponse, status: number, value: unknown, extraHeaders: Record<string, string> = {}) {
  response.writeHead(status, { ...JSON_HEADERS, ...extraHeaders });
  response.end(`${JSON.stringify(value)}\n`);
}
