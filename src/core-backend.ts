import { Hono } from 'hono';
import { type AccessConfiguration, configurationError, verifyAccessIdentity } from './auth';
import { handleCapabilityRequest } from './capabilities';
import {
  type AssetManifestEntry,
  cleanAssetPath,
  cleanSiteName,
  type DeploymentRecord,
  type Identity,
  mayRead,
  mayWrite,
  type SiteRecord,
  validateManifest,
} from './core';
import type { UpRegistry } from './registry';
import {
  cookieValue,
  createSession,
  sessionCookie,
  validReturnUrl,
  verifySession,
} from './session';
import type { SiteDatabase } from './site-database';
import type { SiteRealtime } from './site-realtime';

export interface Env extends AccessConfiguration {
  ASSETS: R2Bucket;
  REGISTRY: DurableObjectNamespace<UpRegistry>;
  CONTROL_HOST?: string;
  SITE_DOMAIN?: string;
  MAX_SITE_BYTES?: string;
  MAX_FILE_BYTES?: string;
  MAX_FILES?: string;
  SESSION_SECRET?: string;
  SITE_DATABASE?: DurableObjectNamespace<SiteDatabase>;
  SITE_REALTIME?: DurableObjectNamespace<SiteRealtime>;
  /** Legacy binding retained only for safe migration of the existing Worker. */
  SITE_SECRETS?: DurableObjectNamespace;
  AI?: Ai;
}

const secure = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: secure });
const registry = (env: Env) => env.REGISTRY.get(env.REGISTRY.idFromName('registry'));
const assetKey = (deployment: DeploymentRecord, path: string) =>
  `deployments/${deployment.siteName}/${deployment.id}/${path}`;

class RegistryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function reg<T>(env: Env, path: string, init?: RequestInit): Promise<T> {
  const response = await registry(env).fetch(`https://registry.internal${path}`, init);
  const body = await response.json<T & { error?: string }>();
  if (!response.ok)
    throw new RegistryError(body.error || 'Registry request failed', response.status);
  return body;
}

function limits(env: Env) {
  const number = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    maxSiteBytes: number(env.MAX_SITE_BYTES, 50 * 1024 * 1024),
    maxFileBytes: number(env.MAX_FILE_BYTES, 10 * 1024 * 1024),
    maxFiles: number(env.MAX_FILES, 500),
  };
}

function sameOrigin(request: Request): Response | null {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  return origin !== new URL(request.url).origin || (fetchSite && fetchSite !== 'same-origin')
    ? json({ error: 'Same-origin request required' }, 403)
    : null;
}

async function controlApi(request: Request, env: Env, identity: Identity): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/api/me') return json(identity);
  if (request.method === 'GET' && url.pathname === '/api/sites') {
    const result = await reg<{ sites: SiteRecord[] }>(env, '/sites');
    return json({ sites: result.sites, siteDomain: env.SITE_DOMAIN || null });
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    const denied = sameOrigin(request);
    if (denied) return denied;
  }

  const create = url.pathname.match(/^\/api\/sites\/([^/]+)\/deployments$/);
  if (request.method === 'POST' && create) {
    const siteName = cleanSiteName(create[1] || '');
    if (!siteName) return json({ error: 'Invalid site name' }, 400);
    const body = await request.json<{ manifest?: unknown }>().catch(() => null);
    if (!body) return json({ error: 'Invalid JSON body' }, 400);
    let manifest: AssetManifestEntry[];
    try {
      manifest = validateManifest(body.manifest, limits(env));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Invalid manifest' }, 400);
    }
    const result = await reg<{ deployment: DeploymentRecord }>(env, '/deployments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        siteName,
        owner: identity.email,
        manifest,
        access: { visibility: 'company', readers: [] },
      }),
    });
    return json(
      { ...result, siteUrl: env.SITE_DOMAIN ? `https://${siteName}.${env.SITE_DOMAIN}` : null },
      201,
    );
  }

  const upload = url.pathname.match(/^\/api\/deployments\/([^/]+)\/assets$/);
  if (request.method === 'PUT' && upload) {
    const { deployment } = await reg<{ deployment: DeploymentRecord }>(
      env,
      `/deployments/${upload[1]}`,
    );
    if (!mayWrite(deployment.owner, identity)) return json({ error: 'Not found' }, 404);
    if (deployment.status !== 'pending') return json({ error: 'Deployment is not pending' }, 409);
    const path = cleanAssetPath(url.searchParams.get('path') || '');
    const expected = path ? deployment.manifest.find((entry) => entry.path === path) : undefined;
    if (!path || !expected) return json({ error: 'Asset is not in the manifest' }, 400);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength !== expected.size)
      return json({ error: 'Asset size does not match manifest' }, 400);
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    if (digest !== expected.sha256)
      return json({ error: 'Asset digest does not match manifest' }, 400);
    await env.ASSETS.put(assetKey(deployment, path), bytes, {
      httpMetadata: { contentType: expected.contentType },
      customMetadata: { sha256: expected.sha256, owner: identity.email },
    });
    return json({ stored: true, path });
  }

  const activate = url.pathname.match(/^\/api\/deployments\/([^/]+)\/activate$/);
  if (request.method === 'POST' && activate) {
    const { deployment } = await reg<{ deployment: DeploymentRecord }>(
      env,
      `/deployments/${activate[1]}`,
    );
    if (!mayWrite(deployment.owner, identity)) return json({ error: 'Not found' }, 404);
    if (deployment.status === 'active') return json({ deployment });
    if (deployment.status !== 'pending')
      return json({ error: 'Deployment cannot be activated' }, 409);
    const heads = await Promise.all(
      deployment.manifest.map((entry) => env.ASSETS.head(assetKey(deployment, entry.path))),
    );
    if (
      heads.some(
        (head, index) =>
          !head || head.customMetadata?.sha256 !== deployment.manifest[index]?.sha256,
      )
    )
      return json({ error: 'All manifest assets must be uploaded before activation' }, 409);
    const result = await reg<{ deployment: DeploymentRecord }>(
      env,
      `/deployments/${deployment.id}/activate`,
      { method: 'POST' },
    );
    return json({
      ...result,
      siteUrl: env.SITE_DOMAIN ? `https://${deployment.siteName}.${env.SITE_DOMAIN}` : null,
    });
  }

  return json({ error: 'Not found' }, 404);
}

async function serveSite(
  request: Request,
  env: Env,
  identity: Identity,
  name: string,
  knownSite?: SiteRecord,
): Promise<Response> {
  const url = new URL(request.url);
  const clean = cleanSiteName(name);
  if (!clean) return new Response('Not found', { status: 404, headers: secure });
  let site: SiteRecord;
  try {
    site = knownSite || (await reg<{ site: SiteRecord }>(env, `/sites/${clean}`)).site;
  } catch (error) {
    if (error instanceof RegistryError && error.status === 404)
      return new Response('Not found', { status: 404, headers: secure });
    throw error;
  }
  if (!mayRead(site, identity)) return new Response('Not found', { status: 404, headers: secure });
  if (url.pathname === '/__up/me') return json({ email: identity.email, visibility: 'company' });
  if (url.pathname.startsWith('/_up/')) {
    const capability = await handleCapabilityRequest(request, env, site, identity);
    if (capability) return capability;
  }
  if (!site.activeDeploymentId) return new Response('Not found', { status: 404, headers: secure });
  const { deployment } = await reg<{ deployment: DeploymentRecord }>(
    env,
    `/deployments/${site.activeDeploymentId}`,
  );
  const path = cleanAssetPath(url.pathname === '/' ? 'index.html' : url.pathname);
  if (!path) return new Response('Not found', { status: 404, headers: secure });
  let object = await env.ASSETS.get(assetKey(deployment, path));
  if (!object && !path.includes('.'))
    object = await env.ASSETS.get(assetKey(deployment, `${path}/index.html`));
  if (!object && request.headers.get('accept')?.includes('text/html'))
    object = await env.ASSETS.get(assetKey(deployment, 'index.html'));
  if (!object) return new Response('Not found', { status: 404, headers: secure });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'private, no-cache');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  headers.set('content-security-policy', "frame-ancestors 'none'");
  return new Response(object.body, { headers });
}

export function isCoreRequest(request: Request, env: Env): boolean {
  const url = new URL(request.url);
  const domain = env.SITE_DOMAIN?.toLowerCase();
  const controlHost = env.CONTROL_HOST?.toLowerCase();
  const host = url.hostname.toLowerCase();
  return (
    Boolean(domain && host !== domain && host !== controlHost && host.endsWith(`.${domain}`)) ||
    url.pathname.startsWith('/api/') ||
    url.pathname === '/app/__session'
  );
}

export async function handleAuthenticatedRequest(request: Request, env: Env, identity: Identity) {
  const url = new URL(request.url);
  const domain = env.SITE_DOMAIN?.toLowerCase();
  const host = url.hostname.toLowerCase();
  if (domain && host !== domain && host.endsWith(`.${domain}`))
    return serveSite(request, env, identity, host.slice(0, -(domain.length + 1)));
  if (url.pathname.startsWith('/api/')) return controlApi(request, env, identity);
  return new Response('Not found', { status: 404, headers: secure });
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (context, next) => {
  const domain = context.env.SITE_DOMAIN?.toLowerCase();
  const url = new URL(context.req.url);
  const host = url.hostname.toLowerCase();
  const controlHost = context.env.CONTROL_HOST?.toLowerCase();
  if (!domain || host === domain || host === controlHost || !host.endsWith(`.${domain}`))
    return next();
  const name = cleanSiteName(host.slice(0, -(domain.length + 1)));
  if (!name) return new Response('Not found', { status: 404, headers: secure });
  let site: SiteRecord;
  try {
    site = (await reg<{ site: SiteRecord }>(context.env, `/sites/${name}`)).site;
  } catch (error) {
    if (error instanceof RegistryError && error.status === 404)
      return new Response('Not found', { status: 404, headers: secure });
    throw error;
  }
  const configError = configurationError(context.env);
  if (configError) return json({ error: configError }, 503);
  let identity: Identity | null = null;
  try {
    identity = await verifyAccessIdentity(context.req.raw, context.env);
  } catch {
    if (context.env.SESSION_SECRET)
      identity = await verifySession(
        cookieValue(context.req.raw, 'up_session'),
        context.env.SESSION_SECRET,
      );
  }
  if (!identity) {
    if (!context.env.SESSION_SECRET || !context.env.CONTROL_HOST)
      return json({ error: 'Private site sessions are not configured' }, 503);
    const broker = new URL('/app/__session', `https://${context.env.CONTROL_HOST}`);
    broker.searchParams.set('return', context.req.url);
    return new Response(null, { status: 302, headers: { ...secure, location: broker.toString() } });
  }
  return serveSite(context.req.raw, context.env, identity, name, site);
});

app.get('/app/__session', async (context) => {
  const configError = configurationError(context.env);
  if (configError) return json({ error: configError }, 503);
  if (!context.env.SESSION_SECRET || !context.env.SITE_DOMAIN)
    return json({ error: 'Private site sessions are not configured' }, 503);
  let identity: Identity;
  try {
    identity = await verifyAccessIdentity(context.req.raw, context.env);
  } catch {
    return json({ error: 'Authentication required' }, 403);
  }
  const target = validReturnUrl(context.req.query('return') || null, context.env.SITE_DOMAIN);
  if (!target) return json({ error: 'Invalid return URL' }, 400);
  const value = await createSession(identity, context.env.SESSION_SECRET);
  return new Response(null, {
    status: 302,
    headers: {
      ...secure,
      location: target.toString(),
      'set-cookie': sessionCookie(value, context.env.SITE_DOMAIN),
    },
  });
});

app.get('/api/health', (context) =>
  context.json({ edge: 'ok', accessConfigured: configurationError(context.env) === null }),
);

app.all('/api/*', async (context) => {
  const configError = configurationError(context.env);
  if (configError) return json({ error: configError }, 503);
  let identity: Identity;
  try {
    identity = await verifyAccessIdentity(context.req.raw, context.env);
  } catch {
    return json({ error: 'Authentication required' }, 403);
  }
  try {
    return await handleAuthenticatedRequest(context.req.raw, context.env, identity);
  } catch (error) {
    if (error instanceof RegistryError) return json({ error: error.message }, error.status);
    return json({ error: 'Request failed' }, 500);
  }
});

app.notFound(() => new Response('Not found', { status: 404, headers: secure }));

export async function runDueSchedules(_env?: Env, _now?: Date): Promise<number> {
  return 0;
}

export default {
  fetch(request: Request, env: Env, context: ExecutionContext) {
    return app.fetch(request, env, context);
  },
};
