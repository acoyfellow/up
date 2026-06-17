/**
 * Single source of truth for Cloudflare credentials used by the operator
 * scripts. Resolution order:
 *   1. CLOUDFLARE_API_TOKEN (explicit env wins, e.g. CI)
 *   2. .cloudflare-oauth.json written by scripts/oauth-bootstrap.ts
 *      (refreshed transparently when expired and a refresh_token exists)
 *
 * No script mints or reads a hand-pasted token elsewhere.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const AUTHORIZE_ENDPOINT = 'https://dash.cloudflare.com/oauth2/auth';
export const TOKEN_ENDPOINT = 'https://dash.cloudflare.com/oauth2/token';
export const REVOKE_ENDPOINT = 'https://dash.cloudflare.com/oauth2/revoke';
export const CREDENTIALS_FILE = resolve(process.cwd(), '.cloudflare-oauth.json');

/**
 * Least-privilege scope set Up needs to provision and run a tenant:
 * create the Access org + application, deploy the control Worker and its
 * route, manage the private R2 bucket, and create the app subdomain record.
 */
export const DEFAULT_SCOPES = [
  'access.write', // Access: Apps and Policies Write
  'workers-scripts.write', // deploy the control Worker (+ Durable Objects)
  'workers-routes.write', // bind the wildcard + app routes
  'workers-r2.write', // create/manage the private assets bucket
  'dns.write', // create the app subdomain/delegation records
  'zone.read', // resolve the target zone
  'zone.write', // create an isolated child zone when requested
  'user-details.read', // identify the connecting operator
];

interface StoredCredentials {
  access_token: string;
  refresh_token: string | null;
  scope?: string;
  token_type?: string;
  expires_at: string | null;
  client_id?: string;
  obtained_at?: string;
}

async function readStored(): Promise<StoredCredentials | null> {
  try {
    return JSON.parse(await readFile(CREDENTIALS_FILE, 'utf8')) as StoredCredentials;
  } catch {
    return null;
  }
}

function isExpired(stored: StoredCredentials): boolean {
  if (!stored.expires_at) return false;
  // 60s safety margin.
  return Date.parse(stored.expires_at) - Date.now() < 60_000;
}

async function refresh(stored: StoredCredentials): Promise<StoredCredentials> {
  if (!stored.refresh_token || !stored.client_id) {
    throw new Error(
      'Stored Cloudflare token expired and cannot be refreshed. Run bun run oauth:connect.',
    );
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: stored.refresh_token,
    client_id: stored.client_id,
  });
  const secret = process.env.UP_OAUTH_CLIENT_SECRET;
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (secret) headers.authorization = `Basic ${btoa(`${stored.client_id}:${secret}`)}`;
  const response = await fetch(TOKEN_ENDPOINT, { method: 'POST', headers, body });
  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok)
    throw new Error(`Token refresh failed (${response.status}): ${JSON.stringify(json)}`);
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 0;
  const next: StoredCredentials = {
    ...stored,
    access_token: json.access_token as string,
    refresh_token: (json.refresh_token as string) ?? stored.refresh_token,
    scope: (json.scope as string) ?? stored.scope,
    expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    obtained_at: new Date().toISOString(),
  };
  await writeFile(CREDENTIALS_FILE, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return next;
}

/** Resolve a usable bearer token, refreshing the stored OAuth token if needed. */
export async function resolveToken(): Promise<string> {
  const explicit = process.env.CLOUDFLARE_API_TOKEN;
  if (explicit) return explicit;
  const stored = await readStored();
  if (!stored?.access_token) {
    throw new Error(
      'No Cloudflare credentials. Run bun run oauth:connect, or set CLOUDFLARE_API_TOKEN.',
    );
  }
  if (isExpired(stored)) return (await refresh(stored)).access_token;
  return stored.access_token;
}
