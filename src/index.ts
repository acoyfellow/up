import { Hono } from 'hono';
import { attachSvelteRoutes, svelteRenderer } from 'svelte-hono';
import { type AccessConfiguration, configurationError, verifyAccessIdentity } from './auth';
import { bundles } from './bundles.generated';
import {
  type AssetManifestEntry,
  cleanAssetPath,
  cleanSiteName,
  type DeploymentRecord,
  type Identity,
  mayRead,
  mayWrite,
  normalizeSiteAccess,
  type SiteAccess,
  type SiteRecord,
  sha256,
  validateManifest,
} from './core';
import { publicAssets } from './public.generated';
import { InhouseRegistry } from './registry';
// @ts-expect-error built by esbuild-svelte
import Site from './site.svelte';
export interface Env extends AccessConfiguration {
  ASSETS: R2Bucket;
  REGISTRY: DurableObjectNamespace<InhouseRegistry>;
  CONTROL_HOST?: string;
  SITE_DOMAIN?: string;
  MAX_SITE_BYTES?: string;
  MAX_FILE_BYTES?: string;
  MAX_FILES?: string;
}
const origin = 'https://up.ax.cloudflare.dev';
const pages = {
  '/': {
    section: 'home',
    title: 'Up — Put Your Company’s Private Web Online',
    description:
      'Drop a static folder and put it online for your company. Up runs in your Cloudflare account and keeps every site behind Access.',
    eyebrow: 'Private sites · Cloudflare Access · your account',
  },
  '/tutorial': {
    section: 'tutorial',
    title: 'Set Up Up on Cloudflare — Tutorial',
    description:
      'Connect Up to your Cloudflare account, establish the Access boundary, and publish a first company-private static site.',
    eyebrow: 'Tutorial · publish a private site',
  },
  '/how-to': {
    section: 'how-to',
    title: 'Operate Company-Private Sites — Up How-to Guides',
    description:
      'Update and verify sites, configure company identity, inspect deployment receipts, and operate Up safely on Cloudflare.',
    eyebrow: 'How-to · operate a deployment',
  },
  '/reference': {
    section: 'reference',
    title: 'Up Reference — API, Limits, and Cloudflare Resources',
    description:
      'Exact Up contracts for authenticated routes, manifests, limits, R2 keys, Durable Object state, Access identity, and headers.',
    eyebrow: 'Reference · exact contracts',
  },
  '/explanation': {
    section: 'explanation',
    title: 'Why Up Is Private by Default — Architecture',
    description:
      'Understand why Up uses an organization-wide Access boundary, private R2, immutable deployments, and a trusted control plane.',
    eyebrow: 'Explanation · the company trust boundary',
  },
  '/app': {
    section: 'app',
    title: 'Put a Private Site Up — Up',
    description: 'Publish a static folder to your authenticated Up installation on Cloudflare.',
    eyebrow: 'Control plane · authenticated employees',
    noindex: true,
  },
  '/offline': {
    section: 'offline',
    title: 'Up is offline',
    description:
      'The cached Inhouse documentation shell is available while the network is offline.',
    eyebrow: 'Offline · cached documentation',
    noindex: true,
  },
} as const;
type Page = {
  section: string;
  title: string;
  description: string;
  eyebrow: string;
  noindex?: boolean;
};
const esc = (v: string) =>
  v.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
function head(path: string, page: Page) {
  const canonical = `${origin}${path === '/' ? '/' : path}`;
  const image = `${origin}/og-card.png`;
  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        name: 'Up',
        applicationCategory: 'DeveloperApplication',
        description: pages['/'].description,
        url: origin,
        codeRepository: 'https://github.com/acoyfellow/up',
        license: 'https://opensource.org/license/mit',
        isAccessibleForFree: true,
        author: { '@type': 'Person', name: 'Jordan Coeyman', url: 'https://coey.dev' },
      },
      {
        '@type': 'TechArticle',
        headline: page.title,
        description: page.description,
        url: canonical,
        image,
        datePublished: '2026-06-12',
        dateModified: '2026-06-12',
      },
    ],
  };
  return `<meta name="description" content="${esc(page.description)}"><meta name="robots" content="${page.noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'}"><link rel="canonical" href="${canonical}"><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><link rel="alternate" href="/llms.txt" type="text/plain"><meta name="theme-color" content="#ffffff"><meta property="og:type" content="website"><meta property="og:site_name" content="Up"><meta property="og:title" content="${esc(page.title)}"><meta property="og:description" content="${esc(page.description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${image}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(page.title)}"><meta name="twitter:description" content="${esc(page.description)}"><meta name="twitter:image" content="${image}"><script type="application/ld+json">${JSON.stringify(schema).replaceAll('<', '\\u003c')}</script>`;
}
const decode = (body: string) => Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
const secure = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: secure });
function limits(env: Env) {
  const n = (v: string | undefined, d: number) => {
    const p = Number(v);
    return Number.isSafeInteger(p) && p > 0 ? p : d;
  };
  return {
    maxSiteBytes: n(env.MAX_SITE_BYTES, 52428800),
    maxFileBytes: n(env.MAX_FILE_BYTES, 10485760),
    maxFiles: n(env.MAX_FILES, 500),
  };
}
const registry = (env: Env) => env.REGISTRY.get(env.REGISTRY.idFromName('registry'));
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
const key = (d: DeploymentRecord, path: string) => `deployments/${d.siteName}/${d.id}/${path}`;
function sameOrigin(request: Request): Response | null {
  const originHeader = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  return originHeader !== new URL(request.url).origin || (fetchSite && fetchSite !== 'same-origin')
    ? json({ error: 'Same-origin request required' }, 403)
    : null;
}
async function api(request: Request, env: Env, identity: Identity): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/api/me') return json(identity);
  if (request.method === 'GET' && url.pathname === '/api/sites') {
    const result = await reg<{ sites: SiteRecord[] }>(env, '/sites');
    return json({
      sites: result.sites.filter((site) => mayRead(site, identity)),
      siteDomain: env.SITE_DOMAIN || null,
    });
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    const denied = sameOrigin(request);
    if (denied) return denied;
  }
  const create = url.pathname.match(/^\/api\/sites\/([^/]+)\/deployments$/);
  if (request.method === 'POST' && create) {
    const siteName = cleanSiteName(create[1] || '');
    if (!siteName) return json({ error: 'Invalid site name' }, 400);
    const body = await request.json<{ manifest?: unknown; access?: unknown }>().catch(() => null);
    if (!body) return json({ error: 'Invalid JSON body' }, 400);
    let manifest: AssetManifestEntry[];
    try {
      manifest = validateManifest(body.manifest, limits(env));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Invalid manifest' }, 400);
    }
    let access: SiteAccess;
    try {
      access = normalizeSiteAccess(body.access);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Invalid site access' }, 400);
    }
    const id = crypto.randomUUID();
    const result = await reg<{ deployment: DeploymentRecord }>(env, '/deployments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, siteName, owner: identity.email, manifest, access }),
    });
    return json(
      { ...result, siteUrl: env.SITE_DOMAIN ? `https://${siteName}.${env.SITE_DOMAIN}` : null },
      201,
    );
  }
  const accessRoute = url.pathname.match(/^\/api\/sites\/([^/]+)\/access$/);
  if (request.method === 'PATCH' && accessRoute) {
    const siteName = cleanSiteName(accessRoute[1] || '');
    if (!siteName) return json({ error: 'Invalid site name' }, 400);
    const { site } = await reg<{ site: SiteRecord }>(env, `/sites/${siteName}`);
    if (!mayWrite(site.owner, identity)) return json({ error: 'Not found' }, 404);
    const body = await request.json<{ access?: unknown }>().catch(() => null);
    if (!body) return json({ error: 'Invalid JSON body' }, 400);
    let access: SiteAccess;
    try {
      access = normalizeSiteAccess(body.access);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Invalid site access' }, 400);
    }
    const result = await reg<{ site: SiteRecord }>(env, `/sites/${siteName}/access`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ access }),
    });
    return json(result);
  }
  const asset = url.pathname.match(/^\/api\/deployments\/([^/]+)\/assets$/);
  if (request.method === 'PUT' && asset) {
    const path = cleanAssetPath(url.searchParams.get('path') || '');
    if (!path) return json({ error: 'Invalid asset path' }, 400);
    const { deployment } = await reg<{ deployment: DeploymentRecord }>(
      env,
      `/deployments/${asset[1]}`,
    );
    if (!mayWrite(deployment.owner, identity)) return json({ error: 'Not found' }, 404);
    if (deployment.status !== 'pending') return json({ error: 'Deployment is not pending' }, 409);
    const expected = deployment.manifest.find((x) => x.path === path);
    if (!expected) return json({ error: 'Asset is not in the manifest' }, 400);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength !== expected.size || (await sha256(bytes)) !== expected.sha256)
      return json({ error: 'Asset does not match its manifest' }, 400);
    await env.ASSETS.put(key(deployment, path), bytes, {
      httpMetadata: { contentType: expected.contentType },
      customMetadata: { sha256: expected.sha256, owner: identity.email },
    });
    return json({ ok: true, path });
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
      deployment.manifest.map((x) => env.ASSETS.head(key(deployment, x.path))),
    );
    if (heads.some((h, i) => !h || h.customMetadata?.sha256 !== deployment.manifest[i]?.sha256))
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
  identity: Identity | undefined,
  name: string,
  knownSite?: SiteRecord,
): Promise<Response> {
  const url = new URL(request.url);
  const clean = cleanSiteName(name);
  if (!clean) return new Response('Not found', { status: 404 });
  let site: SiteRecord;
  try {
    site = knownSite || (await reg<{ site: SiteRecord }>(env, `/sites/${clean}`)).site;
  } catch (error) {
    if (error instanceof RegistryError && error.status === 404)
      return new Response('Not found', { status: 404 });
    throw error;
  }
  if (!mayRead(site, identity)) return new Response('Not found', { status: 404 });
  if (url.pathname === '/__inhouse/me')
    return json({ email: identity?.email || null, visibility: site.access.visibility });
  if (!site.activeDeploymentId) return new Response('Not found', { status: 404 });
  const { deployment } = await reg<{ deployment: DeploymentRecord }>(
    env,
    `/deployments/${site.activeDeploymentId}`,
  );
  const requested = cleanAssetPath(url.pathname === '/' ? 'index.html' : url.pathname);
  if (!requested) return new Response('Not found', { status: 404 });
  let object = await env.ASSETS.get(key(deployment, requested));
  if (!object && !requested.includes('.'))
    object = await env.ASSETS.get(key(deployment, `${requested}/index.html`));
  if (!object && request.headers.get('accept')?.includes('text/html'))
    object = await env.ASSETS.get(key(deployment, 'index.html'));
  if (!object) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  // Site URLs are stable across atomic deployment swaps. Every asset must
  // revalidate so a newly activated deployment cannot be masked by an old
  // immutable browser entry. Protected content must never be marked public.
  headers.set('cache-control', 'private, no-cache');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  headers.set('content-security-policy', "frame-ancestors 'none'");
  return new Response(object.body, { headers });
}
export async function handleAuthenticatedRequest(request: Request, env: Env, identity: Identity) {
  const url = new URL(request.url);
  const domain = env.SITE_DOMAIN?.toLowerCase();
  const host = url.hostname.toLowerCase();
  if (domain && host !== domain && host.endsWith(`.${domain}`))
    return serveSite(request, env, identity, host.slice(0, -(domain.length + 1)));
  if (url.pathname.startsWith('/api/')) return api(request, env, identity);
  return new Response('Not found', { status: 404, headers: secure });
}
const app = new Hono<{ Bindings: Env }>();
// Site hostnames are untrusted content origins. Public is an explicit registry
// state; every other site still requires a verified company identity.
app.use('*', async (c, next) => {
  const domain = c.env.SITE_DOMAIN?.toLowerCase();
  const host = new URL(c.req.url).hostname.toLowerCase();
  const controlHost = c.env.CONTROL_HOST?.toLowerCase();
  if (!domain || host === domain || host === controlHost || !host.endsWith(`.${domain}`))
    return next();
  const name = cleanSiteName(host.slice(0, -(domain.length + 1)));
  if (!name) return new Response('Not found', { status: 404, headers: secure });
  let site: SiteRecord;
  try {
    ({ site } = await reg<{ site: SiteRecord }>(c.env, `/sites/${name}`));
  } catch (error) {
    if (error instanceof RegistryError && error.status === 404)
      return new Response('Not found', { status: 404, headers: secure });
    throw error;
  }
  if (site.access.visibility === 'public')
    return serveSite(c.req.raw, c.env, undefined, name, site);
  const error = configurationError(c.env);
  if (error) return json({ error }, 503);
  let identity: Identity;
  try {
    identity = await verifyAccessIdentity(c.req.raw, c.env);
  } catch {
    return new Response('Authentication required', { status: 403, headers: secure });
  }
  return serveSite(c.req.raw, c.env, identity, name, site);
});
// @ts-expect-error generated bundle helper has no bindings generic
attachSvelteRoutes(app, { bundles });
for (const [path, asset] of Object.entries(publicAssets))
  app.get(
    path,
    () =>
      new Response(decode(asset.body), {
        headers: {
          'content-type': asset.type,
          'cache-control': asset.immutable
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=3600',
          'x-content-type-options': 'nosniff',
          ...(path === '/sw.js' ? { 'service-worker-allowed': '/' } : {}),
        },
      }),
  );
for (const [path, page] of Object.entries(pages)) {
  if (path === '/app') continue;
  app.get(
    path,
    svelteRenderer(Site, {
      hydrateAs: 'site',
      title: page.title,
      head: head(path, page),
      props: { section: page.section, eyebrow: page.eyebrow },
    }),
  );
}
const appPage = pages['/app'];
const renderApp = svelteRenderer(Site, {
  hydrateAs: 'site',
  title: appPage.title,
  head: head('/app', appPage),
  props: { section: 'app', eyebrow: appPage.eyebrow },
});
app.get('/app', async (c, next) => {
  if (configurationError(c.env))
    return c.json({ error: 'Cloudflare Access is not configured' }, 503);
  try {
    await verifyAccessIdentity(c.req.raw, c.env);
  } catch {
    return c.json({ error: 'Authentication required' }, 403);
  }
  return renderApp(c, next);
});
app.get('/api/health', (c) =>
  c.json({ edge: 'ok', accessConfigured: configurationError(c.env) === null }),
);
app.all('/api/*', async (c) => {
  const error = configurationError(c.env);
  if (error) return json({ error }, 503);
  let identity: Identity;
  try {
    identity = await verifyAccessIdentity(c.req.raw, c.env);
  } catch {
    return json({ error: 'Authentication required' }, 403);
  }
  try {
    return await handleAuthenticatedRequest(c.req.raw, c.env, identity);
  } catch (error) {
    if (error instanceof RegistryError) return json({ error: error.message }, error.status);
    return json({ error: 'Request failed' }, 500);
  }
});
const nf = {
  section: 'not-found',
  title: 'Page not found — Up',
  description: 'The requested Up page does not exist.',
  eyebrow: '404 · page not found',
  noindex: true,
};
const render404 = svelteRenderer(Site, {
  hydrateAs: 'site',
  title: nf.title,
  head: head('/404', nf),
  props: { section: nf.section, eyebrow: nf.eyebrow },
});
app.notFound(async (c) => {
  const response = (await render404(c, async () => undefined)) as Response;
  return new Response(response.body, { status: 404, headers: response.headers });
});

export { InhouseRegistry };
export default app;
