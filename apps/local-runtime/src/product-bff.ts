import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { MediaOperation, MediaTransformRequest, PublishRequest } from '@videoos/contracts';
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
const MAX_BODY_BYTES = 16 * 1024;
const MAX_PATH_ID_LENGTH = 256;
const MAX_OPERATIONS = 8;
const MAX_CAPTION_LENGTH = 5000;
const SAFE_TOKEN = /^[a-zA-Z0-9._-]{1,64}$/;

export type ProductBffRuntimeOptions = {
  publisherDriver: 'fake' | 'youtube';
  runPublishOnce?: () => Promise<unknown>;
};

const DEFAULT_RUNTIME_OPTIONS: ProductBffRuntimeOptions = { publisherDriver: 'youtube' };

export function createProductBffServer(
  api: VideoOsApi,
  auth: ProductAuthConfig,
  runtime: ProductBffRuntimeOptions = DEFAULT_RUNTIME_OPTIONS,
) {
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

      if (method === 'GET' && url.pathname === '/api/product/runtime') {
        sendJson(response, 200, {
          publisherDriver: runtime.publisherDriver,
          dryRunPublishEnabled: runtime.publisherDriver === 'fake' && typeof runtime.runPublishOnce === 'function',
        });
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

      const mediaMatch = url.pathname.match(/^\/api\/product\/projects\/([^/]+)\/media-jobs$/);
      if (method === 'POST' && mediaMatch?.[1]) {
        const projectId = decodeBoundedId(mediaMatch[1]);
        const body = await readJsonBody(request);
        const command = parseMediaJobCommand(projectId, principal, body);
        const result = await api.createMediaJob(command);
        sendJson(response, 202, result);
        return;
      }

      const publishPreflightMatch = url.pathname.match(/^\/api\/product\/projects\/([^/]+)\/publish-preflight$/);
      if (method === 'POST' && publishPreflightMatch?.[1]) {
        const projectId = decodeBoundedId(publishPreflightMatch[1]);
        const body = await readJsonBody(request);
        const publishRequest = parsePublishPreflightRequest(projectId, body);
        const result = await api.preflightPublish(principal, publishRequest);
        sendJson(response, 200, { ...result, provider: 'youtube', enqueueAllowed: false });
        return;
      }

      const publishDryRunMatch = url.pathname.match(/^\/api\/product\/projects\/([^/]+)\/publish-dry-run$/);
      if (method === 'POST' && publishDryRunMatch?.[1]) {
        if (runtime.publisherDriver !== 'fake' || typeof runtime.runPublishOnce !== 'function') {
          sendJson(response, 423, { error: 'publish_dry_run_locked' });
          return;
        }
        const projectId = decodeBoundedId(publishDryRunMatch[1]);
        const body = await readJsonBody(request);
        if (body.confirmed !== true) {
          sendJson(response, 400, { error: 'dry_run_confirmation_required' });
          return;
        }
        const publishRequest = parsePublishPreflightRequest(projectId, body);
        const queued = await api.createPublish({
          principal,
          approval: { approvedBy: principal, approvedAt: new Date().toISOString() },
          request: publishRequest,
        });
        const lifecycle = await runtime.runPublishOnce();
        sendJson(response, 202, {
          mode: 'fake',
          jobId: queued.jobId,
          lifecycle,
          providerSideEffect: false,
        });
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
      if (
        message === 'request body too large'
        || message === 'invalid json body'
        || message === 'invalid path identifier'
        || message === 'invalid media job request'
        || message === 'invalid publish preflight request'
        || message === 'publish scheduledAt is invalid'
      ) {
        sendJson(response, 400, { error: 'bad_request' });
        return;
      }
      if (message === 'asset not found in project' || message === 'publish asset not found in project') {
        sendJson(response, 404, { error: 'asset_not_found' });
        return;
      }
      sendJson(response, 500, { error: 'product_bff_failed' });
    }
  });
}

function parsePublishPreflightRequest(projectId: string, body: Record<string, unknown>): PublishRequest {
  const assetId = boundedId(body.assetId);
  const accountId = boundedId(body.accountId);
  const idempotencyKey = boundedId(body.idempotencyKey);
  const mimeType = typeof body.mimeType === 'string' && /^video\/[a-zA-Z0-9.+-]{1,64}$/.test(body.mimeType)
    ? body.mimeType
    : (() => { throw new Error('invalid publish preflight request'); })();
  if (body.caption !== undefined && (typeof body.caption !== 'string' || body.caption.length > MAX_CAPTION_LENGTH)) {
    throw new Error('invalid publish preflight request');
  }
  if (body.scheduledAt !== undefined && (typeof body.scheduledAt !== 'string' || body.scheduledAt.length > 64)) {
    throw new Error('invalid publish preflight request');
  }

  const request: PublishRequest = {
    idempotencyKey,
    projectId,
    targets: [{ network: 'youtube', accountId }],
    assets: [{ assetId, uri: `asset://${encodeURIComponent(assetId)}`, mimeType }],
  };
  if (typeof body.caption === 'string' && body.caption.length > 0) request.caption = body.caption;
  if (typeof body.scheduledAt === 'string' && body.scheduledAt.length > 0) request.scheduledAt = body.scheduledAt;
  return request;
}

function parseMediaJobCommand(projectId: string, principal: Principal, body: Record<string, unknown>) {
  const assetId = boundedId(body.assetId);
  const jobId = boundedId(body.jobId);
  const transform = parseTransform(body.transform);
  return { principal, projectId, assetId, jobId, transform };
}

function parseTransform(value: unknown): Omit<MediaTransformRequest, 'sourceAssetId'> {
  if (!isRecord(value)) throw new Error('invalid media job request');
  const operationsValue = value.operations;
  if (!Array.isArray(operationsValue) || operationsValue.length > MAX_OPERATIONS) throw new Error('invalid media job request');
  const operations = operationsValue.map(parseOperation);
  if (!isRecord(value.output)) throw new Error('invalid media job request');

  const container = safeToken(value.output.container);
  const output: MediaTransformRequest['output'] = { container };
  if (value.output.videoCodec !== undefined) output.videoCodec = safeToken(value.output.videoCodec);
  if (value.output.audioCodec !== undefined) output.audioCodec = safeToken(value.output.audioCodec);
  if (value.output.width !== undefined) output.width = boundedDimension(value.output.width);
  if (value.output.height !== undefined) output.height = boundedDimension(value.output.height);
  if (value.output.fps !== undefined) output.fps = boundedNumber(value.output.fps, 1, 240);

  const transform: Omit<MediaTransformRequest, 'sourceAssetId'> = { operations, output };
  if (value.preset !== undefined) {
    if (!isRecord(value.preset)) throw new Error('invalid media job request');
    transform.preset = {
      id: safeToken(value.preset.id),
      version: boundedInteger(value.preset.version, 1, 1_000_000),
    };
  }
  if (value.frame !== undefined) {
    if (!isRecord(value.frame)) throw new Error('invalid media job request');
    transform.frame = {};
    if (value.frame.atMs !== undefined) transform.frame.atMs = boundedInteger(value.frame.atMs, 0, 24 * 60 * 60 * 1000);
    if (value.frame.width !== undefined) transform.frame.width = boundedDimension(value.frame.width);
    if (value.frame.height !== undefined) transform.frame.height = boundedDimension(value.frame.height);
  }
  return transform;
}

function parseOperation(value: unknown): MediaOperation {
  if (!isRecord(value) || typeof value.type !== 'string') throw new Error('invalid media job request');
  if (value.type === 'trim') {
    const startMs = boundedInteger(value.startMs, 0, 24 * 60 * 60 * 1000);
    const endMs = boundedInteger(value.endMs, 1, 24 * 60 * 60 * 1000);
    if (endMs <= startMs) throw new Error('invalid media job request');
    return { type: 'trim', startMs, endMs };
  }
  if (value.type === 'resize') {
    const fit = value.fit;
    if (fit !== 'cover' && fit !== 'contain') throw new Error('invalid media job request');
    return { type: 'resize', width: boundedDimension(value.width), height: boundedDimension(value.height), fit };
  }
  if (value.type === 'normalize-audio') {
    return { type: 'normalize-audio', targetLufs: boundedNumber(value.targetLufs, -70, 0) };
  }
  if (value.type === 'burn-subtitles') {
    return { type: 'burn-subtitles', subtitleAssetId: boundedId(value.subtitleAssetId) };
  }
  throw new Error('invalid media job request');
}

function safeToken(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_TOKEN.test(value)) throw new Error('invalid media job request');
  return value;
}

function boundedId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_PATH_ID_LENGTH || value.includes('/') || value.includes('\\')) {
    throw new Error('invalid media job request');
  }
  return value;
}

function boundedDimension(value: unknown): number {
  return boundedInteger(value, 1, 8192);
}

function boundedInteger(value: unknown, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new Error('invalid media job request');
  return value as number;
}

function boundedNumber(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('invalid media job request');
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
