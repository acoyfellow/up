import { resolveToken } from './lib/cf-credentials';

interface Envelope<T> {
  success: boolean;
  result: T;
  errors?: Array<{ message: string }>;
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_PERSONAL_ACCOUNT_ID;
const allowedEmail = process.env.INHOUSE_ALLOWED_EMAIL;
const bucketName = process.env.INHOUSE_R2_BUCKET || 'inhouse-assets';
const authName = process.env.INHOUSE_ACCESS_NAME || `inhouse-${crypto.randomUUID().slice(0, 8)}`;
if (!accountId || !allowedEmail) {
  throw new Error(
    'Set CLOUDFLARE_ACCOUNT_ID and INHOUSE_ALLOWED_EMAIL (run bun run oauth:connect first)',
  );
}
// Resolved from CLOUDFLARE_API_TOKEN or the OAuth credential written by oauth:connect.
const token = await resolveToken();
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
async function cf<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { ...headers, ...init?.headers },
  });
  const body = (await response.json()) as Envelope<T>;
  if (!response.ok || !body.success)
    throw new Error(
      body.errors?.map((error) => error.message).join('; ') || `Cloudflare API ${response.status}`,
    );
  return body.result;
}
let organization: { auth_domain?: string };
try {
  organization = await cf(`/accounts/${accountId}/access/organizations`);
} catch (error) {
  if (!(error instanceof Error) || !error.message.toLowerCase().includes('not found')) throw error;
  organization = await cf(`/accounts/${accountId}/access/organizations`, {
    method: 'POST',
    body: JSON.stringify({
      auth_domain: `${authName}.cloudflareaccess.com`,
      name: 'Inhouse',
      session_duration: '24h',
    }),
  });
}
// Ensure the private assets bucket exists before the Worker binds to it.
try {
  const buckets = await cf<{ buckets: Array<{ name: string }> }>(
    `/accounts/${accountId}/r2/buckets`,
  );
  if (!buckets.buckets?.some((bucket) => bucket.name === bucketName)) {
    await cf(`/accounts/${accountId}/r2/buckets`, {
      method: 'POST',
      body: JSON.stringify({ name: bucketName }),
    });
  }
} catch (error) {
  if (!(error instanceof Error) || !error.message.toLowerCase().includes('already')) throw error;
}
const existing = await cf<Array<{ id: string; name?: string; aud?: string }>>(
  `/accounts/${accountId}/access/apps`,
);
let application = existing.find((item) => item.name === 'Inhouse');
if (!application) {
  application = (await cf(`/accounts/${accountId}/access/apps`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Inhouse',
      type: 'self_hosted',
      domain: 'app.inhouse.coey.dev',
      session_duration: '24h',
      enable_binding_cookie: true,
      http_only_cookie_attribute: true,
      same_site_cookie_attribute: 'strict',
      destinations: [
        { type: 'public', uri: 'app.inhouse.coey.dev' },
        { type: 'public', uri: '*.inhouse.coey.dev' },
      ],
      policies: [
        {
          name: 'Inhouse owner',
          decision: 'allow',
          include: [{ email: { email: allowedEmail.toLowerCase() } }],
        },
      ],
    }),
  })) as { id: string; name?: string; aud?: string };
}
if (!organization.auth_domain || !application.aud)
  throw new Error('Access API did not return an auth domain and audience');
console.log(
  JSON.stringify(
    {
      TEAM_DOMAIN: `https://${organization.auth_domain}`,
      POLICY_AUD: application.aud,
      applicationId: application.id,
    },
    null,
    2,
  ),
);
