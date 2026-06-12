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

async function createDeployment(site = `site-${crypto.randomUUID().slice(0, 8)}`) {
  const html = await manifest(
    'index.html',
    '<!doctype html><h1>private receipt</h1>',
    'text/html; charset=utf-8',
  );
  const css = await manifest('assets/app.css', 'h1{color:orange}', 'text/css; charset=utf-8');
  const created = await handleAuthenticatedRequest(
    control(`/api/sites/${site}/deployments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ manifest: [html.entry, css.entry] }),
    }),
    bindings,
    owner,
  );
  expect(created.status).toBe(201);
  const result = await created.json<{ deployment: { id: string }; siteUrl: string }>();
  return { site, id: result.deployment.id, html, css, siteUrl: result.siteUrl };
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
  it('publishes complete immutable assets and serves them only through an authenticated site request', async () => {
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
    const identity = await handleAuthenticatedRequest(
      new Request(`https://${site}.inhouse.example.com/__inhouse/me`),
      bindings,
      owner,
    );
    expect(await identity.json()).toEqual({ email: owner.email });
    const noJwt = await app.fetch(
      new Request(`https://${site}.inhouse.example.com/`),
      bindings,
      createExecutionContext(),
    );
    expect(noJwt.status).toBe(403);
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
