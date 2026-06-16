import { createExecutionContext, env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { configurationError } from '../src/auth';
import {
  cleanAssetPath,
  cleanSiteName,
  type Identity,
  normalizeSiteAccess,
  sha256,
  validateManifest,
} from '../src/core';
import app, { type Env, handleAuthenticatedRequest } from '../src/index';
import { cleanAllowedHosts, cleanSecretName, decryptSecret, encryptSecret } from '../src/secrets';
import { createSession, sessionCookie, validReturnUrl, verifySession } from '../src/session';

const owner: Identity = { email: 'owner@example.com', role: 'member' };
const stranger: Identity = { email: 'stranger@example.com', role: 'member' };
const admin: Identity = { email: 'admin@example.com', role: 'admin' };
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
  it('serves docs publicly but never serves APIs without an Access assertion', async () => {
    expect((await SELF.fetch('https://control.example.com/')).status).toBe(200);
    expect((await SELF.fetch('https://control.example.com/api/sites')).status).toBe(403);
  });
});

describe('input boundaries', () => {
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
  it('validates explicit visibility and reader rules', () => {
    expect(normalizeSiteAccess(undefined)).toEqual({ visibility: 'company', readers: [] });
    expect(
      normalizeSiteAccess({
        visibility: 'restricted',
        readers: [
          { type: 'email', value: 'READER@EXAMPLE.COM' },
          { type: 'domain', value: '@partner.example' },
          { type: 'group', value: 'Engineering' },
        ],
      }),
    ).toEqual({
      visibility: 'restricted',
      readers: [
        { type: 'email', value: 'reader@example.com' },
        { type: 'domain', value: 'partner.example' },
        { type: 'group', value: 'engineering' },
      ],
    });
    expect(() => normalizeSiteAccess({ visibility: 'restricted', readers: [] })).toThrow(
      'at least one reader',
    );
    expect(() =>
      normalizeSiteAccess({
        visibility: 'restricted',
        readers: [
          { type: 'email', value: 'same@example.com' },
          { type: 'email', value: 'same@example.com' },
        ],
      }),
    ).toThrow('unique');
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
      new Request(`https://${site}.inhouse.example.com/`),
      bindings,
      owner,
    );
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('private receipt');
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    expect(page.headers.get('cache-control')).toBe('private, no-cache');
    const identity = await handleAuthenticatedRequest(
      new Request(`https://${site}.inhouse.example.com/__inhouse/me`),
      bindings,
      owner,
    );
    expect(await identity.json()).toEqual({ email: owner.email, visibility: 'company' });
    const noJwt = await app.fetch(
      new Request(`https://${site}.inhouse.example.com/`),
      bindings,
      createExecutionContext(),
    );
    expect(noJwt.status).toBe(302);
    expect(noJwt.headers.get('location')).toContain('/app/__session');
  });
  it('serves explicit public sites anonymously without exposing private sites', async () => {
    const published = await createDeployment(undefined, { visibility: 'public', readers: [] });
    await upload(published.id, published.html);
    await upload(published.id, published.css);
    await handleAuthenticatedRequest(
      control(`/api/deployments/${published.id}/activate`, { method: 'POST' }),
      bindings,
      owner,
    );
    const page = await SELF.fetch(`https://${published.site}.inhouse.example.com/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('private receipt');
    const viewer = await SELF.fetch(`https://${published.site}.inhouse.example.com/__inhouse/me`);
    expect(await viewer.json()).toEqual({ email: null, visibility: 'public' });

    const company = await createDeployment();
    await upload(company.id, company.html);
    await upload(company.id, company.css);
    await handleAuthenticatedRequest(
      control(`/api/deployments/${company.id}/activate`, { method: 'POST' }),
      bindings,
      owner,
    );
    const anonymousCompany = await SELF.fetch(`https://${company.site}.inhouse.example.com/`, {
      redirect: 'manual',
    });
    expect({ status: anonymousCompany.status, body: await anonymousCompany.text() }).toEqual({
      status: 302,
      body: '',
    });
    const session = await createSession(
      owner,
      'test-session-secret-that-is-at-least-32-characters',
    );
    const authenticated = await SELF.fetch(`https://${company.site}.inhouse.example.com/`, {
      headers: { cookie: `up_session=${session}` },
    });
    expect(authenticated.status).toBe(200);
  });
  it('enforces restricted email, domain, and group readers while concealing sites', async () => {
    const restricted = await createDeployment(undefined, {
      visibility: 'restricted',
      readers: [
        { type: 'email', value: stranger.email },
        { type: 'domain', value: 'partner.example' },
        { type: 'group', value: 'engineering' },
      ],
    });
    await upload(restricted.id, restricted.html);
    await upload(restricted.id, restricted.css);
    await handleAuthenticatedRequest(
      control(`/api/deployments/${restricted.id}/activate`, { method: 'POST' }),
      bindings,
      owner,
    );
    for (const identity of [
      stranger,
      { email: 'person@partner.example', role: 'member' as const },
      { email: 'group-user@example.com', role: 'member' as const, groups: ['Engineering'] },
    ]) {
      const page = await handleAuthenticatedRequest(
        new Request(`https://${restricted.site}.inhouse.example.com/`),
        bindings,
        identity,
      );
      expect(page.status).toBe(200);
    }
    const denied = await handleAuthenticatedRequest(
      new Request(`https://${restricted.site}.inhouse.example.com/`),
      bindings,
      { email: 'denied@example.com', role: 'member' },
    );
    expect(denied.status).toBe(404);
  });
  it('loads optional backend code only for site API routes with hard isolation limits', async () => {
    const code = `export default { fetch() { return new Response('dynamic'); } };`;
    const created = await createDeployment(undefined, undefined, code);
    await handleAuthenticatedRequest(
      control(`/api/sites/${created.site}/database`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }),
      bindings,
      owner,
    );
    await upload(created.id, created.html);
    await upload(created.id, created.css);
    if (!created.worker) throw new Error('worker fixture missing');
    await upload(created.id, created.worker);
    await handleAuthenticatedRequest(
      control(`/api/deployments/${created.id}/activate`, { method: 'POST' }),
      bindings,
      owner,
    );
    let loads = 0;
    let loaded: WorkerLoaderWorkerCode | undefined;
    const loader = {
      get(_id: string, getCode: () => Promise<WorkerLoaderWorkerCode>) {
        return {
          getEntrypoint(_name?: string, options?: WorkerStubEntrypointOptions) {
            return {
              async fetch() {
                loads++;
                loaded = await getCode();
                expect(options?.limits).toEqual({ cpuMs: 50, subRequests: 5 });
                return new Response('dynamic response', {
                  status: 201,
                  headers: { 'set-cookie': 'escape=blocked; Domain=.example.com' },
                });
              },
            };
          },
        };
      },
    } as unknown as WorkerLoader;
    const runtimeBindings = Object.assign({}, bindings, { LOADER: loader });
    const staticPage = await handleAuthenticatedRequest(
      new Request(`https://${created.site}.inhouse.example.com/`),
      runtimeBindings,
      owner,
    );
    expect(staticPage.status).toBe(200);
    expect(loads).toBe(0);
    const dynamic = await handleAuthenticatedRequest(
      new Request(`https://${created.site}.inhouse.example.com/api/hello`),
      runtimeBindings,
      owner,
    );
    expect(dynamic.status).toBe(201);
    expect(await dynamic.text()).toBe('dynamic response');
    expect(dynamic.headers.get('set-cookie')).toBeNull();
    expect(dynamic.headers.get('cache-control')).toBe('private, no-store');
    expect(loaded?.modules['_worker.js']).toBe(code);
    expect(loaded?.globalOutbound).toBeNull();
    expect(loaded?.env.UP_DB).toBeTruthy();
    expect(loaded?.env.UP_SECRETS).toBeTruthy();
    expect(loaded?.limits).toEqual({ cpuMs: 50, subRequests: 5 });
  });
  it('returns a generic failure without leaking dynamic code errors', async () => {
    const code = `throw new Error('TOP SECRET STACK');`;
    const created = await createDeployment(undefined, undefined, code);
    await upload(created.id, created.html);
    await upload(created.id, created.css);
    if (!created.worker) throw new Error('worker fixture missing');
    await upload(created.id, created.worker);
    await handleAuthenticatedRequest(
      control(`/api/deployments/${created.id}/activate`, { method: 'POST' }),
      bindings,
      owner,
    );
    const loader = {
      get() {
        throw new Error('TOP SECRET STACK');
      },
    } as unknown as WorkerLoader;
    const response = await handleAuthenticatedRequest(
      new Request(`https://${created.site}.inhouse.example.com/api/fail`),
      Object.assign({}, bindings, { LOADER: loader }),
      owner,
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Dynamic request failed' });
  });
  it('lets only owners and admins change site visibility', async () => {
    const created = await createDeployment();
    const body = JSON.stringify({
      access: { visibility: 'restricted', readers: [{ type: 'email', value: stranger.email }] },
    });
    const strangerResponse = await handleAuthenticatedRequest(
      control(`/api/sites/${created.site}/access`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body,
      }),
      bindings,
      stranger,
    );
    expect(strangerResponse.status).toBe(404);
    const updated = await handleAuthenticatedRequest(
      control(`/api/sites/${created.site}/access`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body,
      }),
      bindings,
      owner,
    );
    expect(updated.status).toBe(200);
    expect((await updated.json<{ site: { access: unknown } }>()).site.access).toEqual({
      visibility: 'restricted',
      readers: [{ type: 'email', value: stranger.email }],
    });
  });
  it('provisions and destroys an isolated per-site SQLite database', async () => {
    const created = await createDeployment();
    const strangerResponse = await handleAuthenticatedRequest(
      control(`/api/sites/${created.site}/database`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }),
      bindings,
      stranger,
    );
    expect(strangerResponse.status).toBe(404);
    const enabled = await handleAuthenticatedRequest(
      control(`/api/sites/${created.site}/database`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }),
      bindings,
      owner,
    );
    expect(
      (await enabled.json<{ site: { databaseEnabled: boolean } }>()).site.databaseEnabled,
    ).toBe(true);
    const database = bindings.SITE_DATABASE?.get(bindings.SITE_DATABASE.idFromName(created.site));
    if (!database) throw new Error('SITE_DATABASE binding missing');
    const query = async (sql: string, params: unknown[] = []) =>
      database.fetch('https://database.internal/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sql, params }),
      });
    expect((await query('CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)')).status).toBe(200);
    expect((await query('INSERT INTO notes(body) VALUES (?)', ['private'])).status).toBe(200);
    const selected = await query('SELECT body FROM notes');
    expect(await selected.json()).toMatchObject({ rows: [{ body: 'private' }] });
    expect((await query("ATTACH DATABASE 'other' AS other")).status).toBe(400);
    expect((await query('SELECT 1; SELECT 2')).status).toBe(400);

    const disabled = await handleAuthenticatedRequest(
      control(`/api/sites/${created.site}/database`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      }),
      bindings,
      owner,
    );
    expect(
      (await disabled.json<{ site: { databaseEnabled: boolean } }>()).site.databaseEnabled,
    ).toBe(false);
    expect((await query('SELECT body FROM notes')).status).toBe(400);
  });
  it('encrypts per-site secret capabilities and never returns plaintext', async () => {
    const key = 'dGVzdC10ZXN0LXNlY3JldHMta2V5LTMyLWJ5dGVzISE';
    const encrypted = await encryptSecret('super-secret-value', key);
    expect(JSON.stringify(encrypted)).not.toContain('super-secret-value');
    expect(await decryptSecret(encrypted, key)).toBe('super-secret-value');
    expect(cleanSecretName('api_token')).toBe('API_TOKEN');
    expect(cleanAllowedHosts(['API.EXAMPLE.COM', 'api.example.com'])).toEqual(['api.example.com']);

    const created = await createDeployment();
    const payload = JSON.stringify({
      value: 'super-secret-value',
      allowedHosts: ['api.example.com'],
    });
    const denied = await handleAuthenticatedRequest(
      control(`/api/sites/${created.site}/secrets/API_TOKEN`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: payload,
      }),
      bindings,
      stranger,
    );
    expect(denied.status).toBe(404);
    const stored = await handleAuthenticatedRequest(
      control(`/api/sites/${created.site}/secrets/API_TOKEN`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: payload,
      }),
      bindings,
      owner,
    );
    expect(stored.status).toBe(201);
    expect(await stored.text()).not.toContain('super-secret-value');
    const listed = await handleAuthenticatedRequest(
      control(`/api/sites/${created.site}/secrets`),
      bindings,
      owner,
    );
    const listing = await listed.text();
    expect(listing).toContain('API_TOKEN');
    expect(listing).toContain('api.example.com');
    expect(listing).not.toContain('super-secret-value');

    const secrets = bindings.SITE_SECRETS?.get(bindings.SITE_SECRETS.idFromName(created.site));
    if (!secrets) throw new Error('SITE_SECRETS binding missing');
    expect((await secrets.fetch('https://secrets.internal/secrets')).status).toBe(404);
    const disallowed = await secrets.fetch('https://secrets.internal/use/API_TOKEN', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://evil.example/collect' }),
    });
    expect(disallowed.status).toBe(403);

    const removed = await handleAuthenticatedRequest(
      control(`/api/sites/${created.site}/secrets/API_TOKEN`, { method: 'DELETE' }),
      bindings,
      owner,
    );
    expect(removed.status).toBe(200);
    const empty = await handleAuthenticatedRequest(
      control(`/api/sites/${created.site}/secrets`),
      bindings,
      owner,
    );
    expect(await empty.json()).toEqual({ secrets: [] });
  });
  it('conceals deployment writes from strangers but allows an administrator', async () => {
    const first = await createDeployment();
    expect((await upload(first.id, first.html, stranger)).status).toBe(404);
    expect((await upload(first.id, first.html, admin)).status).toBe(200);
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
      new Request(`https://${first.site}.inhouse.example.com/`),
      bindings,
      owner,
    );
    expect(await page.text()).toContain('second deployment');
  });
});
