import type { Identity } from './core';

interface SessionPayload {
  email: string;
  role: Identity['role'];
  groups: string[];
  exp: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const raw = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}
async function key(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}
export async function createSession(
  identity: Identity,
  secret: string,
  lifetimeSeconds = 8 * 60 * 60,
): Promise<string> {
  if (secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  const payload: SessionPayload = {
    email: identity.email.toLowerCase(),
    role: identity.role,
    groups: (identity.groups || []).map((group) => group.toLowerCase()),
    exp: Math.floor(Date.now() / 1000) + lifetimeSeconds,
  };
  const body = base64Url(encoder.encode(JSON.stringify(payload)));
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(body)),
  );
  return `${body}.${base64Url(signature)}`;
}
export async function verifySession(
  value: string | undefined,
  secret: string,
): Promise<Identity | null> {
  if (!value || secret.length < 32) return null;
  const [body, signature, extra] = value.split('.');
  if (!body || !signature || extra) return null;
  const valid = await crypto.subtle.verify(
    'HMAC',
    await key(secret),
    decodeBase64Url(signature).buffer as ArrayBuffer,
    encoder.encode(body),
  );
  if (!valid) return null;
  try {
    const payload = JSON.parse(decoder.decode(decodeBase64Url(body))) as SessionPayload;
    if (
      typeof payload.email !== 'string' ||
      !payload.email.includes('@') ||
      !['admin', 'member'].includes(payload.role) ||
      !Array.isArray(payload.groups) ||
      !Number.isSafeInteger(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000)
    )
      return null;
    return { email: payload.email, role: payload.role, groups: payload.groups };
  } catch {
    return null;
  }
}
export function cookieValue(request: Request, name: string): string | undefined {
  const cookie = request.headers.get('cookie');
  if (!cookie) return undefined;
  for (const part of cookie.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return undefined;
}
export function sessionCookie(value: string, siteDomain: string): string {
  return `up_session=${value}; Domain=.${siteDomain}; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=Lax`;
}
export function validReturnUrl(value: string | null, siteDomain: string): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.endsWith(`.${siteDomain}`) ? url : null;
  } catch {
    return null;
  }
}
