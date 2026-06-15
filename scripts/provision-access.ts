import { resolveToken } from './lib/cf-credentials';
import { cfFactory, ensureAccessApp, ensureR2Bucket } from './lib/provision';

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_PERSONAL_ACCOUNT_ID;
const allowEmail = process.env.INHOUSE_ALLOWED_EMAIL;
const allowDomain = process.env.INHOUSE_ALLOWED_DOMAIN;
if (!accountId || (!allowEmail && !allowDomain)) {
  throw new Error(
    'Set CLOUDFLARE_ACCOUNT_ID and INHOUSE_ALLOWED_EMAIL or INHOUSE_ALLOWED_DOMAIN (run bun run oauth:connect first)',
  );
}
const controlHost = process.env.INHOUSE_APP_DOMAIN || 'app.inhouse.coey.dev';
const cf = cfFactory(await resolveToken());

await ensureR2Bucket(cf, accountId, process.env.INHOUSE_R2_BUCKET || 'inhouse-assets');
const result = await ensureAccessApp(cf, {
  accountId,
  appName: process.env.INHOUSE_APP_NAME || 'Inhouse',
  controlHost,
  siteWildcard: process.env.INHOUSE_SITE_WILDCARD || `*.${controlHost}`,
  allowEmail,
  allowDomain,
  teamDomainOverride: process.env.INHOUSE_TEAM_DOMAIN,
});

console.log(
  JSON.stringify(
    {
      TEAM_DOMAIN: `https://${result.teamDomain}`,
      POLICY_AUD: result.policyAud,
      applicationId: result.applicationId,
    },
    null,
    2,
  ),
);
