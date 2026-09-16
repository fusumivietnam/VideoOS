import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'videoos_alpha_session';
const SESSION_SCOPE = 'alpha-access';
const DEFAULT_TTL_SECONDS = 8 * 60 * 60;

export function createAlphaAuthConfig(env = process.env) {
  const accessCode = env.VIDEOOS_WEB_ACCESS_CODE?.trim() ?? '';
  const sessionSecret = env.VIDEOOS_WEB_SESSION_SECRET?.trim() ?? '';
  const enabled = Boolean(accessCode || sessionSecret);
  if (!enabled) return null;
  if (!accessCode || !sessionSecret) throw new Error('protected web mode requires both VIDEOOS_WEB_ACCESS_CODE and VIDEOOS_WEB_SESSION_SECRET');
  if (accessCode.length < 12) throw new Error('VIDEOOS_WEB_ACCESS_CODE must be at least 12 characters');
  if (sessionSecret.length < 32) throw new Error('VIDEOOS_WEB_SESSION_SECRET must be at least 32 characters');
  if (constantTimeEqual(accessCode, sessionSecret)) throw new Error('web access code and session secret must be distinct');

  const ttlSeconds = parsePositiveInt(env.VIDEOOS_WEB_SESSION_TTL_SECONDS, DEFAULT_TTL_SECONDS, 300, 24 * 60 * 60);
  return {
    accessCode,
    sessionSecret,
    ttlSeconds,
    secureCookie: env.VIDEOOS_WEB_COOKIE_SECURE === '1',
  };
}

export function issueSession(config, nowMs = Date.now()) {
  const payload = {
    scope: SESSION_SCOPE,
    exp: nowMs + config.ttlSeconds * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${signature(encoded, config.sessionSecret)}`;
}

export function verifySession(token, config, nowMs = Date.now()) {
  if (!token || typeof token !== 'string' || token.length > 2048) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [encoded, providedSignature] = parts;
  if (!encoded || !providedSignature) return false;
  const expected = signature(encoded, config.sessionSecret);
  if (!constantTimeEqual(expected, providedSignature)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    return payload?.scope === SESSION_SCOPE && Number.isFinite(payload.exp) && payload.exp > nowMs;
  } catch {
    return false;
  }
}

export function verifyAccessCode(value, config) {
  return typeof value === 'string' && value.length <= 1024 && constantTimeEqual(value, config.accessCode);
}

export function readSessionCookie(cookieHeader) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName === SESSION_COOKIE) return rawValue.join('=') || null;
  }
  return null;
}

export function sessionCookie(token, config) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${config.ttlSeconds}${config.secureCookie ? '; Secure' : ''}`;
}

export function clearSessionCookie(config) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${config.secureCookie ? '; Secure' : ''}`;
}

function signature(encoded, secret) {
  return createHmac('sha256', secret).update(encoded).digest('base64url');
}

function constantTimeEqual(left, right) {
  const a = createHash('sha256').update(String(left)).digest();
  const b = createHash('sha256').update(String(right)).digest();
  return timingSafeEqual(a, b);
}

function parsePositiveInt(value, fallback, min, max) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`session TTL must be an integer between ${min} and ${max} seconds`);
  return parsed;
}
