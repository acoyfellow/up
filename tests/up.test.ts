import { createExecutionContext, env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { configurationError } from '../src/auth';
import {
  cleanAssetPath,
  cleanSiteName,
  type Identity,
  sha256,
  validateManifest,
} from '../src/core';
import app, { type Env, handleAuthenticatedRequest, isCoreRequest } from '../src/core-backend';
import {
  createCliAuthorization,
  createSession,
  exchangeCliAuthorization,
  sessionCookie,
  validCliRedirect,
  validReturnUrl,
  verifyCliSession,
  verifySession,
} from '../src/session';

const owner: Identity = { email: 'owner@example.com', role: 'member' };
const bindings = env as unknown as Env;

function control(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('origin', 'https://control.example.com');
  headers.set('sec-fetch-site', 'same-origin');
  return new Request(`https://control.example.com${path}`, { ...init, headers });
}

async function manifest(path: string, body: string, contentType: string) {
  const bytes = new TextEncoder().encode(body);
  return {
    path,
    body,
    bytes,
    entry: { path, size: bytes.byteLength, contentType, sha256: await sha256(bytes.buffer) },
  };
}

async function createDeployment(
  site = `site-${crypto.randomUUID().slice(0, 8)}`,
  access?: unknown,
  workerCode?: string,
) {
  const html = await manifest(
    'index.html',
    '<!doctype html><h1>private receipt</h1>',
    'text/html; charset=utf-8',
  );
  const css = await manifest('assets/app.css', 'h1{color:orange}', 'text/css; charset=utf-8');
  const worker = workerCode
    ? await manifest('_worker.js', workerCode, 'text/javascript; charset=utf-8')
    : undefined;
  const created = await handleAuthenticatedRequest(
    control(`/api/sites/${site}/deployments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        manifest: [html.entry, css.entry, ...(worker ? [worker.entry] : [])],
        access,
      }),
    }),
    bindings,
    owner,
  );
  expect(created.status).toBe(201);
  const result = await created.json<{ deployment: { id: string }; siteUrl: string }>();
  return { site, id: result.deployment.id, html, css, worker, siteUrl: result.siteUrl };
}

async function upload(id: string, asset: Awaited<ReturnType<typeof manifest>>, identity = owner) {
  return handleAuthenticatedRequest(
    control(`/api/deployments/${id}/assets?path=${encodeURIComponent(asset.path)}`, {
      method: 'PUT',
      headers: { 'content-type': asset.entry.contentType },
      body: asset.bytes,
    }),
    bindings,
    identity,
  );
}

describe('security configuration and public surface', () => {
  it('fails closed until Access has exact runtime configuration', () => {
    expect(configurationError({})).toBe('Cloudflare Access is not configured');
    expect(
      configurationError({
        TEAM_DOMAIN: 'https://REPLACE.cloudflareaccess.com',
        POLICY_AUD: 'REPLACE',
      }),
    ).toBe('Cloudflare Access is not configured');
    expect(configurationError({ TEAM_DOMAIN: 'https://example.com', POLICY_AUD: 'aud' })).toContain(
      'cloudflareaccess.com',
    );
  });
  it('keeps the core Worker non-public and rejects APIs without an Access assertion', async () => {
    expect((await SELF.fetch('https://control.example.com/')).status).toBe(404);
    expect((await SELF.fetch('https://control.example.com/api/sites')).status).toBe(403);
  });
});

describe('input boundaries', () => {
  it('dispatches wildcard assets and control APIs ahead of SvelteKit static assets', () => {
    expect(isCoreRequest(new Request('https://demo.up.example.com/icon.svg'), bindings)).toBe(true);
    expect(isCoreRequest(new Request('https://control.example.com/api/sites'), bindings)).toBe(
      true,
    );
    expect(isCoreRequest(new Request('https://control.example.com/icon.svg'), bindings)).toBe(
      false,
    );
  });

  it('accepts safe names and rejects reserved or ambiguous names', () => {
    expect(cleanSiteName('quarterly-planning')).toBe('quarterly-planning');
    for (const value of ['../owner', 'www', 'api', '-bad', 'double--dash', 'UPPER SPACE'])
      expect(cleanSiteName(value)).toBeNull();
  });
  it('rejects traversal, malformed encoding, duplicates, missing index, and invalid digests', () => {
    expect(cleanAssetPath('../secret')).toBeNull();
    expect(cleanAssetPath('%E0%A4%A')).toBeNull();
    expect(() =>
      validateManifest(
        [{ path: 'app.js', size: 1, contentType: 'text/javascript', sha256: '0'.repeat(64) }],
        { maxFiles: 5, maxFileBytes: 10, maxSiteBytes: 20 },
      ),
    ).toThrow('index.html');
    expect(() =>
      validateManifest([{ path: 'index.html', size: 1, contentType: 'text/html', sha256: 'bad' }], {
        maxFiles: 5,
        maxFileBytes: 10,
        maxSiteBytes: 20,
      }),
    ).toThrow('SHA-256');
  });
  it('rejects cross-site mutation requests', async () => {
    const response = await handleAuthenticatedRequest(
      new Request('https://control.example.com/api/sites/test/deployments', {
        method: 'POST',
        headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
        body: '{}',
      }),
      bindings,
      owner,
    );
    expect(response.status).toBe(403);
  });
});

describe('Access-backed site sessions', () => {
  const secret = 'test-session-secret-that-is-at-least-32-characters';
  it('signs, verifies, expires, and rejects tampering', async () => {
    const token = await createSession(
      { email: 'Member@Example.com', role: 'member', groups: ['Engineering'] },
      secret,
      60,
    );
    expect(await verifySession(token, secret)).toEqual({
      email: 'member@example.com',
      role: 'member',
      groups: ['engineering'],
    });
    expect(await verifySession(`${token}x`, secret)).toBeNull();
    expect(await verifySession(await createSession(owner, secret, -1), secret)).toBeNull();
  });
  it('exchanges a short-lived PKCE authorization for a deploy-only CLI session', async () => {
    const verifier = 'v'.repeat(48);
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    );
    const challenge = btoa(String.fromCharCode(...digest))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
    const code = await createCliAuthorization(owner, challenge, secret);
    expect(await verifyCliSession(code, secret)).toBeNull();
    expect(await exchangeCliAuthorization(code, 'wrong-verifier'.repeat(4), secret)).toBeNull();
    const token = await exchangeCliAuthorization(code, verifier, secret);
    expect(await verifyCliSession(token || undefined, secret)).toEqual({ ...owner, groups: [] });
    expect(validCliRedirect('http://127.0.0.1:49152/callback')?.pathname).toBe('/callback');
    expect(validCliRedirect('https://evil.example/callback')).toBeNull();
  });

  it('scopes cookies and return URLs to sibling site hosts', async () => {
    const token = await createSession(owner, secret);
    expect(sessionCookie(token, 'up.example.com')).toContain(
      'Domain=.up.example.com; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=Lax',
    );
    expect(validReturnUrl('https://demo.up.example.com/path', 'up.example.com')?.hostname).toBe(
      'demo.up.example.com',
    );
    expect(validReturnUrl('https://evil.example/path', 'up.example.com')).toBeNull();
    expect(validReturnUrl('javascript:alert(1)', 'up.example.com')).toBeNull();
  });
});

describe('real Durable Object and R2 deployment flow', () => {
  it('does not activate partial or digest-mismatched uploads', async () => {
    const { id, html } = await createDeployment();
    const bad = await handleAuthenticatedRequest(
      control(`/api/deployments/${id}/assets?path=index.html`, { method: 'PUT', body: 'wrong' }),
      bindings,
      owner,
    );
    expect(bad.status).toBe(400);
    expect((await upload(id, html)).status).toBe(200);
    const active = await handleAuthenticatedRequest(
      control(`/api/deployments/${id}/activate`, { method: 'POST' }),
      bindings,
      owner,
    );
    expect(active.status).toBe(409);
  });
  it('publishes complete immutable deployments and privately revalidates stable asset URLs', async () => {
    const { site, id, html, css } = await createDeployment();
    expect((await upload(id, html)).status).toBe(200);
    expect((await upload(id, css)).status).toBe(200);
    const activated = await handleAuthenticatedRequest(
      control(`/api/deployments/${id}/activate`, { method: 'POST' }),
      bindings,
      owner,
    );
    expect(activated.status).toBe(200);
    const page = await handleAuthenticatedRequest(
      new Request(`https://${site}.up.example.com/`),
      bindings,
      owner,
    );
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('private receipt');
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    expect(page.headers.get('cache-control')).toBe('private, no-cache');
    const identity = await handleAuthenticatedRequest(
      new Request(`https://${site}.up.example.com/__up/me`),
      bindings,
      owner,
    );
    expect(await identity.json()).toEqual({ email: owner.email, visibility: 'company' });
    const noJwt = await app.fetch(
      new Request(`https://${site}.up.example.com/`),
      bindings,
      createExecutionContext(),
    );
    expect(noJwt.status).toBe(302);
    expect(noJwt.headers.get('location')).toContain('/app/__session');
  });
  it('provides fixed credential-free site capabilities with site isolation', async () => {
    const first = await createDeployment();
    const second = await createDeployment();
    for (const deployment of [first, second]) {
      await upload(deployment.id, deployment.html);
      await upload(deployment.id, deployment.css);
      await handleAuthenticatedRequest(
        control(`/api/deployments/${deployment.id}/activate`, { method: 'POST' }),
        bindings,
        owner,
      );
    }

    const capability = (site: string, path: string, init: RequestInit = {}) => {
      const origin = `https://${site}.up.example.com`;
      const headers = new Headers(init.headers);
      headers.set('origin', origin);
      headers.set('sec-fetch-site', 'same-origin');
      return handleAuthenticatedRequest(
        new Request(`${origin}/_up/${path}`, { ...init, headers }),
        bindings,
        owner,
      );
    };

    const client = await capability(first.site, 'client.js');
    expect(client.status).toBe(200);
    expect(await client.text()).toContain('export const up=');

    const identity = await capability(first.site, 'identity');
    expect(await identity.json()).toEqual({ email: owner.email, groups: [], role: 'member' });

    const created = await capability(first.site, 'db/votes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ choice: 'Tacos' }),
    });
    expect(created.status).toBe(201);
    const document = await created.json<{ id: string; choice: string }>();
    expect(document.choice).toBe('Tacos');
    const list = await capability(first.site, 'db/votes');
    expect((await list.json<{ documents: unknown[] }>()).documents).toContainEqual(document);
    const isolatedList = await capability(second.site, 'db/votes');
    expect((await isolatedList.json<{ documents: unknown[] }>()).documents).toEqual([]);

    const stored = await capability(first.site, 'files/menu.txt', {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: 'tacos',
    });
    expect(stored.status).toBe(201);
    expect(await (await capability(first.site, 'files/menu.txt')).text()).toBe('tacos');
    expect((await capability(second.site, 'files/menu.txt')).status).toBe(404);
    const files = await capability(first.site, 'files');
    expect((await files.json<{ files: Array<{ name: string }> }>()).files).toContainEqual(
      expect.objectContaining({ name: 'menu.txt' }),
    );

    const ai = await capability(first.site, 'ai/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    });
    expect(ai.status).toBe(503);

    const connect = async () => {
      const response = await capability(first.site, 'realtime/votes', {
        headers: { upgrade: 'websocket' },
      });
      expect(response.status).toBe(101);
      const socket = response.webSocket;
      if (!socket) throw new Error('Realtime WebSocket missing');
      socket.accept();
      return socket;
    };
    const sender = await connect();
    const receiver = await connect();
    const received = new Promise<Record<string, unknown>>((resolve) => {
      receiver.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as Record<string, unknown>;
        if (message.type === 'vote') resolve(message);
      });
    });
    sender.send(JSON.stringify({ type: 'vote', data: { choice: 'Tacos' } }));
    await expect(received).resolves.toMatchObject({
      type: 'vote',
      data: { choice: 'Tacos' },
      sender: owner.email,
    });
    sender.close();
    receiver.close();
  });
  it('atomically supersedes a previous complete deployment', async () => {
    const first = await createDeployment();
    await upload(first.id, first.html);
    await upload(first.id, first.css);
    await handleAuthenticatedRequest(
      control(`/api/deployments/${first.id}/activate`, { method: 'POST' }),
      bindings,
      owner,
    );
    const secondHtml = await manifest('index.html', '<h1>second deployment</h1>', 'text/html');
    const created = await handleAuthenticatedRequest(
      control(`/api/sites/${first.site}/deployments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ manifest: [secondHtml.entry] }),
      }),
      bindings,
      owner,
    );
    const second = await created.json<{ deployment: { id: string } }>();
    await upload(second.deployment.id, secondHtml);
    await handleAuthenticatedRequest(
      control(`/api/deployments/${second.deployment.id}/activate`, { method: 'POST' }),
      bindings,
      owner,
    );
    const page = await handleAuthenticatedRequest(
      new Request(`https://${first.site}.up.example.com/`),
      bindings,
      owner,
    );
    expect(await page.text()).toContain('second deployment');
  });
});
