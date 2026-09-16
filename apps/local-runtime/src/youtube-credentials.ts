import { mkdir, chmod, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { YouTubeCredentialProvider } from './youtube-publisher.js';

export const YOUTUBE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
] as const;

export interface YouTubeOAuthCredentialRecord {
  projectId: string;
  accountId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  createdAt: string;
  updatedAt: string;
}

export interface YouTubeOAuthCredentialStore {
  get(input: { projectId: string; accountId: string }): Promise<YouTubeOAuthCredentialRecord | undefined>;
  put(record: YouTubeOAuthCredentialRecord): Promise<void>;
  disconnect(input: { projectId: string; accountId: string }): Promise<void>;
}

export class InMemoryYouTubeOAuthCredentialStore implements YouTubeOAuthCredentialStore {
  private readonly records = new Map<string, YouTubeOAuthCredentialRecord>();

  async get(input: { projectId: string; accountId: string }): Promise<YouTubeOAuthCredentialRecord | undefined> {
    return this.records.get(credentialKey(input));
  }

  async put(record: YouTubeOAuthCredentialRecord): Promise<void> {
    this.records.set(credentialKey(record), { ...record });
  }

  async disconnect(input: { projectId: string; accountId: string }): Promise<void> {
    this.records.delete(credentialKey(input));
  }
}

export class JsonFileYouTubeOAuthCredentialStore implements YouTubeOAuthCredentialStore {
  constructor(private readonly filePath: string) {}

  async get(input: { projectId: string; accountId: string }): Promise<YouTubeOAuthCredentialRecord | undefined> {
    const records = await this.readAll();
    return records[credentialKey(input)];
  }

  async put(record: YouTubeOAuthCredentialRecord): Promise<void> {
    const records = await this.readAll();
    records[credentialKey(record)] = { ...record };
    await this.writeAll(records);
  }

  async disconnect(input: { projectId: string; accountId: string }): Promise<void> {
    const records = await this.readAll();
    delete records[credentialKey(input)];
    await this.writeAll(records);
  }

  private async readAll(): Promise<Record<string, YouTubeOAuthCredentialRecord>> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid credential store');
      return parsed as Record<string, YouTubeOAuthCredentialRecord>;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return {};
      throw new YouTubeCredentialError('credential-store-failed', 'Unable to read YouTube credential store');
    }
  }

  private async writeAll(records: Record<string, YouTubeOAuthCredentialRecord>): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
      const temporary = `${this.filePath}.tmp-${process.pid}`;
      await writeFile(temporary, `${JSON.stringify(records, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await chmod(temporary, 0o600);
      await rename(temporary, this.filePath);
      await chmod(this.filePath, 0o600);
    } catch {
      throw new YouTubeCredentialError('credential-store-failed', 'Unable to persist YouTube credential store');
    }
  }
}

export interface YouTubeOAuthClientInput {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface YouTubeCredentialManagerOptions {
  store: YouTubeOAuthCredentialStore;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export class YouTubeCredentialManager {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly options: YouTubeCredentialManagerOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  authorizationUrl(input: YouTubeOAuthClientInput & { state: string }): string {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', input.clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('scope', YOUTUBE_OAUTH_SCOPES.join(' '));
    url.searchParams.set('state', input.state);
    return url.toString();
  }

  async connectWithAuthorizationCode(input: YouTubeOAuthClientInput & {
    projectId: string;
    accountId: string;
    code: string;
  }): Promise<void> {
    const body = new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      grant_type: 'authorization_code',
      redirect_uri: input.redirectUri,
    });
    const response = await this.fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) throw tokenEndpointError(response.status);
    const payload = await response.json().catch(() => null) as { refresh_token?: unknown } | null;
    if (!payload || typeof payload.refresh_token !== 'string' || !payload.refresh_token) {
      throw new YouTubeCredentialError('oauth-failed', 'YouTube OAuth response did not include a refresh token; reconnect with consent');
    }
    const existing = await this.options.store.get({ projectId: input.projectId, accountId: input.accountId });
    const now = this.now().toISOString();
    await this.options.store.put({
      projectId: input.projectId,
      accountId: input.accountId,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      refreshToken: payload.refresh_token,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  async rotate(input: Omit<YouTubeOAuthCredentialRecord, 'createdAt' | 'updatedAt'>): Promise<void> {
    const existing = await this.options.store.get(input);
    const now = this.now().toISOString();
    await this.options.store.put({ ...input, createdAt: existing?.createdAt ?? now, updatedAt: now });
  }

  async disconnect(input: { projectId: string; accountId: string }): Promise<void> {
    await this.options.store.disconnect(input);
  }
}

export interface RefreshingYouTubeCredentialProviderOptions {
  store: YouTubeOAuthCredentialStore;
  fetchImpl?: typeof fetch;
  now?: () => number;
  refreshSkewMs?: number;
}

export class RefreshingYouTubeCredentialProvider implements YouTubeCredentialProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly refreshSkewMs: number;
  private readonly cache = new Map<string, { accessToken: string; expiresAt: number }>();

  constructor(private readonly options: RefreshingYouTubeCredentialProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.refreshSkewMs = options.refreshSkewMs ?? 60_000;
  }

  async getAccessToken(input: { projectId: string; accountId: string }): Promise<string> {
    const key = credentialKey(input);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt - this.refreshSkewMs > this.now()) return cached.accessToken;

    const record = await this.options.store.get(input);
    if (!record) throw new YouTubeCredentialError('not-connected', 'YouTube account is not connected for this project');

    const response = await this.fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: record.clientId,
        client_secret: record.clientSecret,
        refresh_token: record.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!response.ok) throw tokenEndpointError(response.status);
    const payload = await response.json().catch(() => null) as { access_token?: unknown; expires_in?: unknown } | null;
    if (!payload || typeof payload.access_token !== 'string' || !payload.access_token) {
      throw new YouTubeCredentialError('oauth-failed', 'YouTube OAuth refresh returned an invalid token response');
    }
    const expiresInSeconds = typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)
      ? Math.max(60, payload.expires_in)
      : 3600;
    this.cache.set(key, { accessToken: payload.access_token, expiresAt: this.now() + expiresInSeconds * 1000 });
    return payload.access_token;
  }
}

export class YouTubeCredentialError extends Error {
  constructor(
    readonly code: 'not-connected' | 'oauth-failed' | 'credential-store-failed',
    message: string,
  ) {
    super(message);
    this.name = 'YouTubeCredentialError';
  }
}

function credentialKey(input: { projectId: string; accountId: string }): string {
  if (!input.projectId || !input.accountId) throw new YouTubeCredentialError('credential-store-failed', 'YouTube credentials require projectId and accountId');
  return `${encodeURIComponent(input.projectId)}:${encodeURIComponent(input.accountId)}`;
}

function tokenEndpointError(status: number): YouTubeCredentialError {
  return new YouTubeCredentialError('oauth-failed', `YouTube OAuth token request failed with status ${status}`);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
