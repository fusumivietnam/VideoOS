import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const PRODUCT_SESSION_COOKIE = 'videoos_product_session';
const SESSION_SCOPE = 'product-access';
const DEFAULT_TTL_SECONDS = 8 * 60 * 60;

export interface ProductAccessIdentity {
  principalId: string;
  accessCode: string;
}

export interface ProductAuthConfig {
  identities: ProductAccessIdentity[];
  sessionSecret: string;
  ttlSeconds: number;
  secureCookie: boolean;
}

export function createProductAuthConfig(env: NodeJS.ProcessEnv = process.env): ProductAuthConfig {
  const rawIdentities = env.VIDEOOS_PRODUCT_IDENTITIES_JSON?.trim() ?? '';
  const sessionSecret = env.VIDEOOS_PRODUCT_SESSION_SECRET?.trim() ?? '';
  if (!rawIdentities || !sessionSecret) {
    throw new Error('product auth requires VIDEOOS_PRODUCT_IDENTITIES_JSON and VIDEOOS_PRODUCT_SESSION_SECRET');
  }
  if (sessionSecret.length < 32) throw new Error('VIDEOOS_PRODUCT_SESSION_SECRET must be at least 32 characters');

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawIdentities);
  } catch {
    throw new Error('VIDEOOS_PRODUCT_IDENTITIES_JSON must be valid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 100) {
    throw new Error('VIDEOOS_PRODUCT_IDENTITIES_JSON must contain between 1 and 100 identities');
  }

  const identities = parsed.map((value, index) => normalizeIdentity(value, index));
  const principalIds = new Set<string>();
  for (const identity of identities) {
    if (principalIds.has(identity.principalId)) throw new Error(`duplicate product principal id: ${identity.principalId}`);
    principalIds.add(identity.principalId);
    if (constantTimeEqual(identity.accessCode, sessionSecret)) {
      throw new Error('product access code and session secret must be distinct');
    }
  }

  return {
    identities,
    sessionSecret,
    ttlSeconds: parsePositiveInt(env.VIDEOOS_PRODUCT_SESSION_TTL_SECONDS, DEFAULT_TTL_SECONDS, 300, 24 * 60 * 60),
    secureCookie: env.VIDEOOS_PRODUCT_COOKIE_SECURE === '1',
  };
}

export function authenticateAccessCode(value: unknown, config: ProductAuthConfig): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > 1024) return null;
  let principalId: string | null = null;
  for (const identity of config.identities) {
    if (constantTimeEqual(value, identity.accessCode)) principalId = identity.principalId;
  }
  return principalId;
}

export function issueProductSession(principalId: string, config: ProductAuthConfig, nowMs = Date.now()): string {
  const payload = {
    scope: SESSION_SCOPE,
    principalId,
    exp: nowMs + config.ttlSeconds * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${signature(encoded, config.sessionSecret)}`;
}

export function verifyProductSession(token: string | null, config: ProductAuthConfig, nowMs = Date.now()): string | null {
  if (!token || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, providedSignature] = parts;
  if (!encoded || !providedSignature) return null;
  if (!constantTimeEqual(signature(encoded, config.sessionSecret), providedSignature)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (payload.scope !== SESSION_SCOPE) return null;
    if (typeof payload.principalId !== 'string' || !validPrincipalId(payload.principalId)) return null;
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= nowMs) return null;
    if (!config.identities.some((identity) => identity.principalId === payload.principalId)) return null;
    return payload.principalId;
  } catch {
    return null;
  }
}

export function readProductSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName === PRODUCT_SESSION_COOKIE) return rawValue.join('=') || null;
  }
  return null;
}

export function productSessionCookie(token: string, config: ProductAuthConfig): string {
  return `${PRODUCT_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${config.ttlSeconds}${config.secureCookie ? '; Secure' : ''}`;
}

export function clearProductSessionCookie(config: ProductAuthConfig): string {
  return `${PRODUCT_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${config.secureCookie ? '; Secure' : ''}`;
}

function normalizeIdentity(value: unknown, index: number): ProductAccessIdentity {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`product identity ${index} must be an object`);
  }
  const candidate = value as Record<string, unknown>;
  const principalId = typeof candidate.principalId === 'string' ? candidate.principalId.trim() : '';
  const accessCode = typeof candidate.accessCode === 'string' ? candidate.accessCode.trim() : '';
  if (!validPrincipalId(principalId)) throw new Error(`product identity ${index} has invalid principalId`);
  if (accessCode.length < 12 || accessCode.length > 1024) {
    throw new Error(`product identity ${index} accessCode must be between 12 and 1024 characters`);
  }
  return { principalId, accessCode };
}

function validPrincipalId(value: string): boolean {
  return value.length >= 1 && value.length <= 200 && /^[A-Za-z0-9:_@.\-]+$/.test(value);
}

function signature(encoded: string, secret: string): string {
  return createHmac('sha256', secret).update(encoded).digest('base64url');
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = createHash('sha256').update(String(left)).digest();
  const b = createHash('sha256').update(String(right)).digest();
  return timingSafeEqual(a, b);
}

function parsePositiveInt(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`product session TTL must be an integer between ${min} and ${max} seconds`);
  }
  return parsed;
}
