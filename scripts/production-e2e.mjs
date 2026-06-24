import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const control = process.env.UP_CONTROL_ORIGIN || 'https://up.coey.dev';
const siteDomain = process.env.UP_SITE_DOMAIN || 'up.coey.dev';
const accessToken = process.env.CF_ACCESS_TOKEN;
if (!accessToken)
  throw new Error(`Set CF_ACCESS_TOKEN from cloudflared access token -app ${control}`);
const site = `receipt-${Date.now().toString(36)}`;
const authHeaders = {
  'cf-access-token': accessToken,
  origin: control,
  'sec-fetch-site': 'same-origin',
};
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};
async function walk(directory) {
  return (
    await Promise.all(
      (
        await readdir(directory, { withFileTypes: true })
      ).map((entry) =>
        entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)],
      ),
    )
  ).flat();
}
async function publish(directory) {
  const files = await walk(directory);
  const assets = await Promise.all(
    files.map(async (file) => {
      const body = await readFile(file);
      const path = relative(directory, file).split(sep).join('/');
      const extension = `.${path.split('.').pop()}`;
      return {
        path,
        body,
        entry: {
          path,
          size: body.byteLength,
          contentType: types[extension] || 'application/octet-stream',
          sha256: createHash('sha256').update(body).digest('hex'),
        },
      };
    }),
  );
  const created = await fetch(`${control}/api/sites/${site}/deployments`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ manifest: assets.map((asset) => asset.entry) }),
  });
  if (!created.ok) throw new Error(`create: ${created.status} ${await created.text()}`);
  const deployment = (await created.json()).deployment;
  for (const asset of assets) {
    const response = await fetch(
      `${control}/api/deployments/${deployment.id}/assets?path=${encodeURIComponent(asset.path)}`,
      {
        method: 'PUT',
        headers: { ...authHeaders, 'content-type': asset.entry.contentType },
        body: asset.body,
      },
    );
    if (!response.ok)
      throw new Error(`upload ${asset.path}: ${response.status} ${await response.text()}`);
  }
  const activated = await fetch(`${control}/api/deployments/${deployment.id}/activate`, {
    method: 'POST',
    headers: authHeaders,
  });
  if (!activated.ok) throw new Error(`activate: ${activated.status} ${await activated.text()}`);
  return deployment.id;
}
const firstId = await publish('examples/baseline-site');
const siteUrl = `https://${site}.${siteDomain}`;
const authenticated = await fetch(siteUrl, { headers: { 'cf-access-token': accessToken } });
const authenticatedBody = await authenticated.text();
if (!authenticated.ok || !authenticatedBody.includes('Private by default.'))
  throw new Error(`authenticated site failed: ${authenticated.status}`);
const me = await fetch(`${siteUrl}/__up/me`, { headers: { 'cf-access-token': accessToken } });
const identity = await me.json();
if (!me.ok || !identity.email) throw new Error('authenticated identity endpoint failed');
const anonymous = await fetch(siteUrl, { redirect: 'manual' });
const anonymousBody = await anonymous.text();
if (
  anonymousBody.includes('Private by default.') ||
  (anonymous.status >= 200 && anonymous.status < 300)
)
  throw new Error(`anonymous request reached content: ${anonymous.status}`);
console.log(
  JSON.stringify(
    {
      site,
      siteUrl,
      deploymentId: firstId,
      identity: identity.email,
      authenticatedStatus: authenticated.status,
      anonymousStatus: anonymous.status,
      anonymousLocation: anonymous.headers.get('location'),
      verifiedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
