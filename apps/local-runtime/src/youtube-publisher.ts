import { createHash } from 'node:crypto';

import type { PublishAsset, PublishReceipt, PublishRequest, PublishTarget } from '@videoos/contracts';
import type { AssetRepository, ObjectStore } from '@videoos/storage';
import type { NetworkPublisherAdapter } from '../../../services/publisher/src/index.js';

export const YOUTUBE_CAPABILITIES = {
  network: 'youtube' as const,
  uploadVideo: true,
  scheduling: true,
  reconciliation: true,
  maxAssetsPerTarget: 1,
  credentialModel: 'oauth2-access-token' as const,
};

export interface YouTubeCredentialProvider {
  getAccessToken(input: { projectId: string; accountId: string }): Promise<string>;
}

export interface YouTubeAssetBodyLoader {
  load(input: { projectId: string; asset: PublishAsset }): Promise<Uint8Array>;
}

export class StoredYouTubeAssetBodyLoader implements YouTubeAssetBodyLoader {
  constructor(private readonly assets: AssetRepository, private readonly objects: ObjectStore) {}

  async load(input: { projectId: string; asset: PublishAsset }): Promise<Uint8Array> {
    const record = await this.assets.getById(input.asset.assetId);
    if (!record || record.projectId !== input.projectId) throw new Error('YouTube publish asset not found in project');
    if (record.contentType !== input.asset.mimeType) throw new Error('YouTube publish asset MIME type does not match stored asset');
    const body = await this.objects.get(record.objectKey);
    if (!body) throw new Error('YouTube publish asset object is missing');
    return body;
  }
}

export interface YouTubeUploadInput {
  projectId: string;
  accessToken: string;
  asset: PublishAsset;
  title: string;
  description?: string;
  privacyStatus: 'private' | 'unlisted' | 'public';
  publishAt?: string;
  idempotencyMarker: string;
}

export interface YouTubeUploadResult { videoId: string; externalUrl?: string; }
export interface YouTubeReconcileInput { accessToken: string; target: PublishTarget; idempotencyMarker: string; }
export interface YouTubeTransport {
  upload(input: YouTubeUploadInput): Promise<YouTubeUploadResult>;
  reconcile?(input: YouTubeReconcileInput): Promise<YouTubeUploadResult | null>;
}

export type YouTubeAttemptState =
  | { status: 'prepared'; fingerprint: string; marker: string }
  | { status: 'uncertain'; fingerprint: string; marker: string }
  | { status: 'confirmed'; fingerprint: string; marker: string; videoId: string; externalUrl?: string };

export interface YouTubeAttemptStore {
  get(key: string): Promise<YouTubeAttemptState | undefined>;
  put(key: string, value: YouTubeAttemptState): Promise<void>;
  clear(key: string): Promise<void>;
}
export interface JsonValueStore<T> {
  get(key: string): Promise<T | undefined>;
  put(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}
export class JsonBackedYouTubeAttemptStore implements YouTubeAttemptStore {
  constructor(private readonly store: JsonValueStore<YouTubeAttemptState>) {}
  get(key: string): Promise<YouTubeAttemptState | undefined> { return this.store.get(key); }
  put(key: string, value: YouTubeAttemptState): Promise<void> { return this.store.put(key, value); }
  clear(key: string): Promise<void> { return this.store.delete(key); }
}
export class InMemoryYouTubeAttemptStore implements YouTubeAttemptStore {
  private readonly values = new Map<string, YouTubeAttemptState>();
  async get(key: string): Promise<YouTubeAttemptState | undefined> { return this.values.get(key); }
  async put(key: string, value: YouTubeAttemptState): Promise<void> { this.values.set(key, value); }
  async clear(key: string): Promise<void> { this.values.delete(key); }
}

export class YouTubePublishError extends Error {
  constructor(
    readonly code: 'invalid-request' | 'rate-limited' | 'retryable' | 'uncertain-outcome' | 'provider-failed',
    message: string,
    readonly retryAfterMs?: number,
  ) { super(message); this.name = 'YouTubePublishError'; }
}
export class YouTubeTransportError extends Error {
  constructor(
    readonly code: 'rate-limited' | 'retryable' | 'provider-failed',
    message: string,
    readonly outcome: 'not-created' | 'unknown' = 'unknown',
    readonly retryAfterMs?: number,
  ) { super(message); this.name = 'YouTubeTransportError'; }
}

export interface YouTubePublisherAdapterOptions {
  credentials: YouTubeCredentialProvider;
  transport: YouTubeTransport;
  attempts: YouTubeAttemptStore;
}

export class YouTubePublisherAdapter implements NetworkPublisherAdapter {
  readonly network = 'youtube' as const;
  constructor(private readonly options: YouTubePublisherAdapterOptions) {}

  async publish(request: PublishRequest): Promise<PublishReceipt[]> {
    if (request.assets.length !== 1) throw new YouTubePublishError('invalid-request', 'YouTube adapter requires exactly one video asset per publish request');
    const asset = request.assets[0]!;
    const youtubeTargets = request.targets.filter((target) => target.network === 'youtube');
    if (youtubeTargets.length !== request.targets.length || youtubeTargets.length === 0) {
      throw new YouTubePublishError('invalid-request', 'YouTube adapter accepts only YouTube targets');
    }
    const receipts: PublishReceipt[] = [];
    for (const target of youtubeTargets) receipts.push(await this.publishTarget(request, asset, target));
    return receipts;
  }

  private async publishTarget(request: PublishRequest, asset: PublishAsset, target: PublishTarget): Promise<PublishReceipt> {
    const key = attemptKey(request, target);
    const fingerprint = requestFingerprint(request, target);
    const marker = `videoos-${createHash('sha256').update(key).digest('hex').slice(0, 20)}`;
    const existing = await this.options.attempts.get(key);
    if (existing && existing.fingerprint !== fingerprint) throw new YouTubePublishError('invalid-request', 'YouTube idempotency key was reused with different publish content');
    if (existing?.status === 'confirmed') return confirmedReceipt(target, existing.videoId, existing.externalUrl);

    const accessToken = await this.options.credentials.getAccessToken({ projectId: request.projectId, accountId: target.accountId });
    if (existing?.status === 'prepared' || existing?.status === 'uncertain') {
      if (this.options.transport.reconcile) {
        const reconciled = await this.options.transport.reconcile({ accessToken, target, idempotencyMarker: existing.marker });
        if (reconciled) {
          const confirmed: YouTubeAttemptState = {
            status: 'confirmed', fingerprint, marker: existing.marker, videoId: reconciled.videoId,
            ...(reconciled.externalUrl ? { externalUrl: reconciled.externalUrl } : {}),
          };
          await this.options.attempts.put(key, confirmed);
          return confirmedReceipt(target, reconciled.videoId, reconciled.externalUrl);
        }
      }
      throw new YouTubePublishError('uncertain-outcome', 'Previous YouTube publish outcome is uncertain; reconciliation is required before re-upload');
    }

    await this.options.attempts.put(key, { status: 'prepared', fingerprint, marker });
    try {
      const uploaded = await this.options.transport.upload({
        projectId: request.projectId,
        accessToken,
        asset,
        title: youtubeTitle(request),
        ...(request.caption ? { description: request.caption } : {}),
        privacyStatus: youtubePrivacyStatus(request),
        ...(request.scheduledAt ? { publishAt: request.scheduledAt } : {}),
        idempotencyMarker: marker,
      });
      const confirmed: YouTubeAttemptState = {
        status: 'confirmed', fingerprint, marker, videoId: uploaded.videoId,
        ...(uploaded.externalUrl ? { externalUrl: uploaded.externalUrl } : {}),
      };
      await this.options.attempts.put(key, confirmed);
      return confirmedReceipt(target, uploaded.videoId, uploaded.externalUrl);
    } catch (error) {
      if (error instanceof YouTubeTransportError && error.outcome === 'not-created') {
        await this.options.attempts.clear(key);
        throw new YouTubePublishError(error.code, bounded(error.message), error.retryAfterMs);
      }
      await this.options.attempts.put(key, { status: 'uncertain', fingerprint, marker });
      if (error instanceof YouTubeTransportError) throw new YouTubePublishError('uncertain-outcome', bounded(error.message), error.retryAfterMs);
      throw new YouTubePublishError('uncertain-outcome', 'YouTube upload failed with an unknown remote outcome');
    }
  }
}

export class NodeYouTubeResumableTransport implements YouTubeTransport {
  constructor(private readonly assets: YouTubeAssetBodyLoader, private readonly fetchImpl: typeof fetch = fetch) {}

  async upload(input: YouTubeUploadInput): Promise<YouTubeUploadResult> {
    let body: Uint8Array;
    try {
      body = await this.assets.load({ projectId: input.projectId, asset: input.asset });
    } catch (error) {
      throw new YouTubeTransportError('provider-failed', bounded(error instanceof Error ? error.message : 'YouTube asset loading failed'), 'not-created');
    }
    const metadata = {
      snippet: {
        title: input.title,
        ...(input.description ? { description: input.description } : {}),
        tags: [input.idempotencyMarker],
      },
      status: {
        privacyStatus: input.publishAt ? 'private' : input.privacyStatus,
        ...(input.publishAt ? { publishAt: input.publishAt } : {}),
      },
    };
    const start = await this.fetchImpl('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        'content-type': 'application/json; charset=utf-8',
        'x-upload-content-length': String(body.byteLength),
        'x-upload-content-type': input.asset.mimeType,
      },
      body: JSON.stringify(metadata),
    });
    if (!start.ok) throw await transportErrorFromResponse(start, 'not-created');
    const location = start.headers.get('location');
    if (!location) throw new YouTubeTransportError('provider-failed', 'YouTube resumable upload did not return a session location', 'not-created');

    let finish: Response;
    try {
      finish = await this.fetchImpl(location, {
        method: 'PUT',
        headers: {
          'content-type': input.asset.mimeType,
          'content-length': String(body.byteLength),
          'content-range': `bytes 0-${body.byteLength - 1}/${body.byteLength}`,
        },
        body: Buffer.from(body),
      });
    } catch {
      const recovered = await this.queryCompletedSession(location, input.accessToken, body.byteLength);
      if (recovered) return recovered;
      throw new YouTubeTransportError('retryable', 'YouTube upload connection failed after the resumable session was created', 'unknown');
    }
    if (!finish.ok) {
      if (finish.status === 308) {
        const recovered = await this.queryCompletedSession(location, input.accessToken, body.byteLength);
        if (recovered) return recovered;
      }
      throw await transportErrorFromResponse(finish, finish.status >= 500 || finish.status === 429 || finish.status === 308 ? 'unknown' : 'not-created');
    }
    return parseUploadResponse(finish);
  }

  async reconcile(input: YouTubeReconcileInput): Promise<YouTubeUploadResult | null> {
    const search = new URL('https://www.googleapis.com/youtube/v3/search');
    search.searchParams.set('part', 'id');
    search.searchParams.set('type', 'video');
    search.searchParams.set('forMine', 'true');
    search.searchParams.set('q', input.idempotencyMarker);
    search.searchParams.set('maxResults', '10');
    const response = await this.fetchImpl(search, { headers: { authorization: `Bearer ${input.accessToken}` } });
    if (!response.ok) throw await transportErrorFromResponse(response, 'unknown');
    const payload = await response.json().catch(() => null) as { items?: Array<{ id?: { videoId?: unknown } }> } | null;
    const candidateIds = (payload?.items ?? []).map((item) => item.id?.videoId).filter((value): value is string => typeof value === 'string' && value.length > 0);
    if (!candidateIds.length) return null;

    const details = new URL('https://www.googleapis.com/youtube/v3/videos');
    details.searchParams.set('part', 'snippet,status');
    details.searchParams.set('id', candidateIds.join(','));
    const detailResponse = await this.fetchImpl(details, { headers: { authorization: `Bearer ${input.accessToken}` } });
    if (!detailResponse.ok) throw await transportErrorFromResponse(detailResponse, 'unknown');
    const detailPayload = await detailResponse.json().catch(() => null) as {
      items?: Array<{ id?: unknown; snippet?: { tags?: unknown; channelId?: unknown } }>;
    } | null;
    const exact = (detailPayload?.items ?? []).filter((item) =>
      typeof item.id === 'string' &&
      Array.isArray(item.snippet?.tags) &&
      item.snippet.tags.includes(input.idempotencyMarker) &&
      (!input.target.channelId || item.snippet?.channelId === input.target.channelId),
    );
    if (!exact.length) return null;
    if (exact.length > 1) throw new YouTubeTransportError('provider-failed', 'Multiple YouTube videos match one idempotency marker', 'unknown');
    const videoId = exact[0]!.id as string;
    return { videoId, externalUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` };
  }

  private async queryCompletedSession(location: string, accessToken: string, totalBytes: number): Promise<YouTubeUploadResult | null> {
    let response: Response;
    try {
      response = await this.fetchImpl(location, {
        method: 'PUT',
        headers: { authorization: `Bearer ${accessToken}`, 'content-length': '0', 'content-range': `bytes */${totalBytes}` },
      });
    } catch { return null; }
    if (response.ok) return parseUploadResponse(response);
    return null;
  }
}

function attemptKey(request: PublishRequest, target: PublishTarget): string { return ['youtube', request.projectId, target.accountId, target.channelId ?? '', request.idempotencyKey].join(':'); }
function requestFingerprint(request: PublishRequest, target: PublishTarget): string {
  return createHash('sha256').update(JSON.stringify({ projectId: request.projectId, target, assets: request.assets, caption: request.caption, scheduledAt: request.scheduledAt, metadata: request.metadata })).digest('hex');
}
function youtubeTitle(request: PublishRequest): string {
  const configured = request.metadata?.youtubeTitle;
  if (typeof configured === 'string' && configured.trim()) return configured.trim().slice(0, 100);
  const fromCaption = request.caption?.trim();
  return fromCaption ? fromCaption.slice(0, 100) : 'VideoOS upload';
}
function youtubePrivacyStatus(request: PublishRequest): 'private' | 'unlisted' | 'public' {
  if (request.scheduledAt) return 'private';
  const value = request.metadata?.youtubePrivacyStatus;
  return value === 'private' || value === 'unlisted' || value === 'public' ? value : 'private';
}
function confirmedReceipt(target: PublishTarget, videoId: string, externalUrl?: string): PublishReceipt {
  return { target, externalPostId: videoId, externalUrl: externalUrl ?? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, status: 'published' };
}
async function parseUploadResponse(response: Response): Promise<YouTubeUploadResult> {
  const parsed = await response.json().catch(() => null) as { id?: unknown } | null;
  if (!parsed || typeof parsed.id !== 'string' || !parsed.id) throw new YouTubeTransportError('provider-failed', 'YouTube upload succeeded without a video id', 'unknown');
  return { videoId: parsed.id, externalUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(parsed.id)}` };
}
async function transportErrorFromResponse(response: Response, outcome: 'not-created' | 'unknown'): Promise<YouTubeTransportError> {
  const retryAfterSeconds = Number(response.headers.get('retry-after'));
  const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? Math.round(retryAfterSeconds * 1000) : undefined;
  const text = bounded(await response.text().catch(() => ''));
  if (response.status === 429) return new YouTubeTransportError('rate-limited', text || 'YouTube rate limited the request', outcome, retryAfterMs);
  if (response.status >= 500 || response.status === 308) return new YouTubeTransportError('retryable', text || `YouTube returned ${response.status}`, outcome, retryAfterMs);
  return new YouTubeTransportError('provider-failed', text || `YouTube returned ${response.status}`, outcome);
}
function bounded(value: string): string { return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 1024); }
