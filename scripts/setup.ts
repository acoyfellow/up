/**
 * One-shot installer: connect → provision → wire AUD → deploy.
 *
 * A human never creates or copies an AUD. This script creates the Access
 * application, reads the generated AUD, injects it into a gitignored Wrangler
 * config, and deploys.
 *
 * Required env:
 *   CLOUDFLARE_ACCOUNT_ID
 *   UP_CONTROL_HOST                  e.g. sites.example.com
 *   UP_ALLOWED_EMAIL | UP_ALLOWED_DOMAIN
 *   UP_ZONE_NAME                     existing deployment zone
 *     OR
 *   UP_PARENT_ZONE                   create/delegate CONTROL_HOST as a child zone
 *
 * Optional: UP_APP_NAME, UP_R2_BUCKET, UP_TEAM_DOMAIN, UP_CONFIG_OUT,
 * UP_ADMIN_EMAILS, UP_COMPAT_DATE. Legacy INHOUSE_* names remain supported.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolveToken } from './lib/cf-credentials';
import { ensureChildDelegation, ensureChildZone, waitForActiveZone } from './lib/child-zone';
import {
  cfFactory,
  ensureAccessApp,
  ensureR2Bucket,
  ensureWildcardDns,
  resaveAccessApp,
} from './lib/provision';

const setting = (name: string) => process.env[`UP_${name}`] || process.env[`INHOUSE_${name}`];
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const controlHost = setting('CONTROL_HOST');
const configuredZone = setting('ZONE_NAME');
const parentZone = setting('PARENT_ZONE');
const allowEmail = setting('ALLOWED_EMAIL');
const allowDomain = setting('ALLOWED_DOMAIN');
if (
  !accountId ||
  !controlHost ||
  (!configuredZone && !parentZone) ||
  (!allowEmail && !allowDomain)
) {
  throw new Error(
    'Required: CLOUDFLARE_ACCOUNT_ID, UP_CONTROL_HOST, UP_ZONE_NAME or UP_PARENT_ZONE, and UP_ALLOWED_EMAIL or UP_ALLOWED_DOMAIN',
  );
}

const appName = (setting('APP_NAME') || controlHost.split('.')[0] || controlHost).toLowerCase();
const bucket = setting('R2_BUCKET') || `${appName}-assets`;
const siteWildcard = `*.${controlHost}`;
const configOut = setting('CONFIG_OUT') || `wrangler.${appName}.jsonc`;
const compatDate = setting('COMPAT_DATE') || '2026-06-12';
const adminEmails = setting('ADMIN_EMAILS') || allowEmail || '';
const token = await resolveToken();
const cf = cfFactory(token);
const secretsKeyFile = setting('SECRETS_KEY_FILE') || '.up-secrets-key';
let secretsKey = setting('SECRETS_KEY');
if (!secretsKey) {
  try {
    secretsKey = (await readFile(secretsKeyFile, 'utf8')).trim();
  } catch {
    secretsKey = randomBytes(32).toString('base64url');
    await writeFile(secretsKeyFile, `${secretsKey}\n`, { mode: 0o600 });
  }
}
const sessionSecretFile = setting('SESSION_SECRET_FILE') || '.up-session-secret';
let sessionSecret = setting('SESSION_SECRET');
if (!sessionSecret) {
  try {
    sessionSecret = (await readFile(sessionSecretFile, 'utf8')).trim();
  } catch {
    sessionSecret = randomBytes(48).toString('base64url');
    await writeFile(sessionSecretFile, `${sessionSecret}\n`, { mode: 0o600 });
  }
}
if (sessionSecret.length < 32) throw new Error('UP_SESSION_SECRET must be at least 32 characters');

let deploymentZone = configuredZone || controlHost;
if (parentZone) {
  console.log(`[1/6] Ensuring isolated child zone "${controlHost}"…`);
  const child = await ensureChildZone(cf, accountId, controlHost);
  console.log(`[2/6] Delegating only "${controlHost}" from parent "${parentZone}"…`);
  await ensureChildDelegation(cf, accountId, parentZone, child);
  console.log(`[3/6] Waiting for child zone activation…`);
  await waitForActiveZone(cf, accountId, controlHost);
  deploymentZone = controlHost;
} else {
  console.log(`[1/6] Using existing zone "${deploymentZone}"…`);
}

console.log(`[4/6] Ensuring private R2 bucket "${bucket}"…`);
await ensureR2Bucket(cf, accountId, bucket);

console.log(`[5/6] Ensuring Access application and injecting its generated AUD…`);
let access = await ensureAccessApp(cf, {
  accountId,
  appName,
  controlHost,
  siteWildcard,
  allowEmail,
  allowDomain,
  teamDomainOverride: setting('TEAM_DOMAIN'),
});
if (parentZone) {
  const resaved = await resaveAccessApp(cf, accountId, access.applicationId);
  access = { ...access, policyAud: resaved.policyAud };
}

await ensureWildcardDns(cf, accountId, deploymentZone, controlHost);
const config = {
  $schema: 'node_modules/wrangler/config-schema.json',
  name: appName,
  main: 'build/worker.bundled.mjs',
  compatibility_date: compatDate,
  compatibility_flags: ['nodejs_compat'],
  workers_dev: false,
  preview_urls: false,
  observability: { enabled: true },
  build: { command: 'bun run build' },
  routes: [
    { pattern: controlHost, custom_domain: true },
    { pattern: `${siteWildcard}/*`, zone_name: deploymentZone },
  ],
  vars: {
    TEAM_DOMAIN: `https://${access.teamDomain}`,
    POLICY_AUD: access.policyAud,
    ADMIN_EMAILS: adminEmails,
    CONTROL_HOST: controlHost,
    SITE_DOMAIN: controlHost,
    MAX_SITE_BYTES: '52428800',
    MAX_FILE_BYTES: '10485760',
    MAX_FILES: '500',
  },
  durable_objects: {
    bindings: [
      { name: 'REGISTRY', class_name: 'InhouseRegistry' },
      { name: 'SITE_DATABASE', class_name: 'SiteDatabase' },
      { name: 'SITE_SECRETS', class_name: 'SiteSecrets' },
    ],
  },
  migrations: [
    { tag: 'v1', new_sqlite_classes: ['InhouseRegistry'] },
    { tag: 'v2', new_sqlite_classes: ['SiteDatabase'] },
    { tag: 'v3', new_sqlite_classes: ['SiteSecrets'] },
  ],
  r2_buckets: [{ binding: 'ASSETS', bucket_name: bucket }],
  worker_loaders: [{ binding: 'LOADER' }],
  triggers: { crons: ['* * * * *'] },
};
await writeFile(
  configOut,
  `// Generated by bun run setup. Gitignored: contains account Access config.\n${JSON.stringify(config, null, 2)}\n`,
);

console.log(`[6/6] Deploying "${appName}" into zone "${deploymentZone}"…`);
await new Promise<void>((resolve, reject) => {
  const child = spawn('bunx', ['wrangler', 'deploy', '-c', configOut], {
    stdio: 'inherit',
    env: { ...process.env, CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: accountId },
  });
  child.on('error', reject);
  child.on('close', (code) =>
    code === 0 ? resolve() : reject(new Error(`wrangler exited ${code}`)),
  );
});

async function putSecret(name: string, value: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('bunx', ['wrangler', 'secret', 'put', name, '-c', configOut], {
      stdio: ['pipe', 'inherit', 'inherit'],
      env: { ...process.env, CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: accountId },
    });
    child.stdin.end(value);
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`wrangler secret put exited ${code}`)),
    );
  });
}
console.log('Uploading private site-session signing secret…');
await putSecret('SESSION_SECRET', sessionSecret);
console.log('Uploading private secret-encryption key…');
await putSecret('SECRETS_KEY', secretsKey);

console.log(`\nDone. https://${controlHost} is live behind Cloudflare Access.`);
console.log('The Access AUD and private runtime secrets were wired automatically.');
