/**
 * Local "Connect with Cloudflare" bootstrap.
 *
 * Runs the Cloudflare OAuth 2.0 Authorization Code + PKCE flow against the
 * account OAuth server, then writes a scoped, refreshable token to
 * .cloudflare-oauth.json. Every other script reads that file through
 * scripts/lib/cf-credentials.ts, so no API token is ever minted by hand.
 *
 * This is the developer/operator path. The same flow is what a customer runs
 * through the hosted "Connect with Cloudflare" button described in
 * docs/how-to/connect-cloudflare.md.
 */
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import {
  AUTHORIZE_ENDPOINT,
  CREDENTIALS_FILE,
  DEFAULT_SCOPES,
  TOKEN_ENDPOINT,
} from './lib/cf-credentials';

const clientId = process.env.UP_OAUTH_CLIENT_ID;
const clientSecret = process.env.UP_OAUTH_CLIENT_SECRET;
const redirectUri = process.env.UP_OAUTH_REDIRECT || 'http://localhost:8976/callback';
const scopes = (process.env.UP_OAUTH_SCOPES || DEFAULT_SCOPES.join(' ')).trim();

if (!clientId) {
  console.error(
    [
      'Set UP_OAUTH_CLIENT_ID (and UP_OAUTH_CLIENT_SECRET for a confidential client).',
      '',
      'Create the client once at https://dash.cloudflare.com/?to=/:account/oauth-clients',
      `Redirect URL: ${redirectUri}`,
      `Scopes: ${DEFAULT_SCOPES.join(' ')}`,
    ].join('\n'),
  );
  process.exit(1);
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
const challenge = base64Url(
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
);
const state = base64Url(crypto.getRandomValues(new Uint8Array(16)));

const redirect = new URL(redirectUri);
const port = Number(redirect.port || '80');

const authorizeUrl = new URL(AUTHORIZE_ENDPOINT);
authorizeUrl.search = new URLSearchParams({
  response_type: 'code',
  client_id: clientId,
  redirect_uri: redirectUri,
  scope: scopes,
  state,
  code_challenge: challenge,
  code_challenge_method: 'S256',
}).toString();

function openInBrowser(url: string) {
  if (process.env.UP_OAUTH_NO_OPEN) return;
  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(opener, [url], { stdio: 'ignore', detached: true }).on('error', () => {});
}

async function exchange(code: string): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId as string,
    code_verifier: verifier,
  });
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (clientSecret) {
    headers.authorization = `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
  }
  const response = await fetch(TOKEN_ENDPOINT, { method: 'POST', headers, body });
  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

console.log('Opening the Cloudflare authorization page in your browser.');
console.log('If it does not open, paste this URL:\n');
console.log(`${authorizeUrl}\n`);
openInBrowser(authorizeUrl.toString());

let token: Record<string, unknown>;
try {
  token = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const server = Bun.serve({
      port,
      hostname: redirect.hostname,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname !== redirect.pathname) return new Response('Not found', { status: 404 });
        const error = url.searchParams.get('error');
        if (error) {
          server.stop();
          reject(new Error(`Authorization denied: ${error}`));
          return new Response('Authorization failed. You can close this tab.', { status: 400 });
        }
        if (url.searchParams.get('state') !== state) {
          return new Response('State mismatch.', { status: 400 });
        }
        const code = url.searchParams.get('code');
        if (!code) return new Response('Missing authorization code.', { status: 400 });
        try {
          const result = await exchange(code);
          server.stop();
          resolve(result);
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>Connected</title><body style="font:16px system-ui;padding:48px;color:#171717">Cloudflare account connected. You can close this tab and return to the terminal.</body>',
            { headers: { 'content-type': 'text/html' } },
          );
        } catch (caught) {
          server.stop();
          reject(caught);
          return new Response('Token exchange failed. Check the terminal.', { status: 500 });
        }
      },
    });
    console.log(`Waiting for the redirect on ${redirectUri} ...`);
  });
} catch (caught) {
  console.error(`\n${caught instanceof Error ? caught.message : String(caught)}`);
  process.exit(1);
}

const expiresIn = typeof token.expires_in === 'number' ? token.expires_in : 0;
const record = {
  access_token: token.access_token,
  refresh_token: token.refresh_token ?? null,
  scope: token.scope ?? scopes,
  token_type: token.token_type ?? 'bearer',
  expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
  client_id: clientId,
  obtained_at: new Date().toISOString(),
};
await writeFile(CREDENTIALS_FILE, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });

console.log(`\nConnected. Token stored in ${CREDENTIALS_FILE} (gitignored, mode 600).`);
console.log('Scripts read it automatically. For ad-hoc shells:');
console.log('  export CLOUDFLARE_API_TOKEN="$(bun run scripts/print-token.ts)"');
console.log('\nNext: bun run company:access:provision  →  bun run company:deploy:app');
