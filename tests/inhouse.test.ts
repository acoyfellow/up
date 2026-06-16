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
    expect(noJwt.status).toBe(403);
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
    expect((await SELF.fetch(`https://${company.site}.inhouse.example.com/`)).status).toBe(403);
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
    expect(loaded?.env).toEqual({});
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
