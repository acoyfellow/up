import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const control = process.env.UP_CONTROL_ORIGIN || 'https://up.coey.dev';
const siteDomain = process.env.UP_SITE_DOMAIN || 'up.coey.dev';
const accessToken = process.env.CF_ACCESS_TOKEN;
const readerEmail = process.env.UP_TEST_EMAIL;
if (!accessToken || !readerEmail)
  throw new Error(
    `Set CF_ACCESS_TOKEN and UP_TEST_EMAIL (token: cloudflared access token -app ${control})`,
  );

const site = `dynamic-receipt-${Date.now().toString(36)}`;
const folder = 'examples/dynamic-site';
const authHeaders = {
  'cf-access-token': accessToken,
  origin: control,
  'sec-fetch-site': 'same-origin',
};
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? walk(path) : [path];
      }),
    )
  ).flat();
}
const files = await Promise.all(
  (await walk(folder)).map(async (path) => {
    const bytes = await readFile(path);
    const assetPath = relative(folder, path).split(sep).join('/');
    const extension = `.${assetPath.split('.').pop()}`;
    return {
      path: assetPath,
      bytes,
      entry: {
        path: assetPath,
        size: bytes.byteLength,
        contentType: types[extension] || 'application/octet-stream',
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    };
  }),
);
async function controlFetch(path, init = {}) {
  return fetch(`${control}${path}`, {
    ...init,
    headers: { ...authHeaders, ...init.headers },
    redirect: init.redirect || 'manual',
  });
}
async function json(response) {
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(value)}`);
  return value;
}
async function setAccess(access) {
  return json(
    await controlFetch(`/api/sites/${site}/access`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ access }),
    }),
  );
}

console.log(`[1/9] Creating ${site}`);
const creation = await json(
  await controlFetch(`/api/sites/${site}/deployments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      manifest: files.map((file) => file.entry),
      access: { visibility: 'company', readers: [] },
    }),
  }),
);
for (const file of files) {
  await json(
    await controlFetch(
      `/api/deployments/${creation.deployment.id}/assets?path=${encodeURIComponent(file.path)}`,
      { method: 'PUT', headers: { 'content-type': file.entry.contentType }, body: file.bytes },
    ),
  );
}
const activation = await json(
  await controlFetch(`/api/deployments/${creation.deployment.id}/activate`, { method: 'POST' }),
);
const siteUrl = activation.siteUrl || `https://${site}.${siteDomain}`;

console.log('[2/9] Enabling isolated SQLite');
await json(
  await controlFetch(`/api/sites/${site}/database`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true }),
  }),
);

console.log('[3/9] Storing write-only secret metadata');
const canarySecret = `never-return-${crypto.randomUUID()}`;
await json(
  await controlFetch(`/api/sites/${site}/secrets/CANARY_TOKEN`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: canarySecret, allowedHosts: ['api.example.com'] }),
  }),
);
const secretListing = JSON.stringify(await json(await controlFetch(`/api/sites/${site}/secrets`)));
if (!secretListing.includes('CANARY_TOKEN') || secretListing.includes(canarySecret))
  throw new Error('Secret metadata receipt leaked or omitted the canary');

console.log('[4/9] Creating scheduled receipt');
await json(
  await controlFetch(`/api/sites/${site}/schedules`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      path: '/api/receipt',
      cron: '* * * * *',
      maxRunsPerDay: 4,
      retryLimit: 2,
    }),
  }),
);

console.log('[5/9] Minting an Access-backed sibling session');
const broker = await controlFetch(
  `/app/__session?return=${encodeURIComponent(`${siteUrl}/api/receipt`)}`,
  { redirect: 'manual' },
);
if (broker.status !== 302) throw new Error(`Session broker returned ${broker.status}`);
const cookies =
  typeof broker.headers.getSetCookie === 'function'
    ? broker.headers.getSetCookie()
    : [broker.headers.get('set-cookie') || ''];
const upCookie = cookies.map((value) => value.match(/up_session=[^;]+/)?.[0]).find(Boolean);
if (!upCookie) throw new Error('Session broker did not mint up_session');

console.log('[6/9] Verifying company Dynamic Worker + database');
const privateReceipt = await fetch(`${siteUrl}/api/receipt`, {
  headers: { cookie: upCookie },
  redirect: 'manual',
});
const privateBody = await json(privateReceipt);
if (privateBody.runtime !== 'dynamic-worker' || !Array.isArray(privateBody.database))
  throw new Error('Dynamic/database receipt failed');
const anonymousCompany = await fetch(`${siteUrl}/api/receipt`, { redirect: 'manual' });
if (
  anonymousCompany.status !== 302 ||
  !anonymousCompany.headers.get('location')?.includes('/app/__session')
)
  throw new Error(`Company site did not redirect to broker: ${anonymousCompany.status}`);

console.log('[7/9] Verifying explicit public visibility');
await setAccess({ visibility: 'public', readers: [] });
const publicReceipt = await fetch(`${siteUrl}/api/receipt`, { redirect: 'manual' });
if (publicReceipt.status !== 200 || (await publicReceipt.json()).runtime !== 'dynamic-worker')
  throw new Error(`Public dynamic site failed: ${publicReceipt.status}`);

console.log('[8/9] Verifying restricted visibility');
await setAccess({ visibility: 'restricted', readers: [{ type: 'email', value: readerEmail }] });
const anonymousRestricted = await fetch(`${siteUrl}/api/receipt`, { redirect: 'manual' });
if (anonymousRestricted.status !== 302)
  throw new Error('Restricted site was anonymously available');
const restrictedReceipt = await fetch(`${siteUrl}/api/receipt`, { headers: { cookie: upCookie } });
if (restrictedReceipt.status !== 200) throw new Error('Restricted reader session was denied');

console.log('[9/9] Waiting for scheduled audit receipt');
const deadline = Date.now() + 150_000;
let audit;
while (Date.now() < deadline) {
  audit = await json(await controlFetch(`/api/sites/${site}/audit`));
  if (audit.audit?.some((entry) => entry.action === 'schedule.run_succeeded')) break;
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}
if (!audit?.audit?.some((entry) => entry.action === 'schedule.run_succeeded'))
  throw new Error('Scheduled run receipt did not arrive');
const auditText = JSON.stringify(audit);
if (auditText.includes(canarySecret) || auditText.includes('_worker.js'))
  throw new Error('Audit receipt contains secret or code');

console.log(
  JSON.stringify(
    {
      siteUrl,
      visibility: 'restricted',
      files: files.length,
      dynamic: true,
      database: true,
      secretNames: ['CANARY_TOKEN'],
      scheduled: true,
      anonymousDenied: true,
    },
    null,
    2,
  ),
);
