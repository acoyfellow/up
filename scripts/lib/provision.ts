/**
 * Reusable Cloudflare provisioning primitives shared by the CLI
 * (provision-access.ts) and the one-shot installer (setup.ts).
 *
 * Nothing here ever asks a human to create or copy an AUD: ensureAccessApp
 * creates the Access application and returns the AUD it generated, which the
 * caller injects into config or a secret.
 */

interface Envelope<T> {
  success: boolean;
  result: T;
  errors?: Array<{ message: string }>;
}

export type Cf = <T>(path: string, init?: RequestInit) => Promise<T>;

export function cfFactory(token: string): Cf {
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  return async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      ...init,
      headers: { ...headers, ...init?.headers },
    });
    const text = await response.text();
    const body = text ? (JSON.parse(text) as Envelope<T> | null) : null;
    if (!response.ok || (body && !body.success)) {
      throw new Error(
        body?.errors?.map((e) => e.message).join('; ') || `Cloudflare API ${response.status}`,
      );
    }
    return body?.result as T;
  };
}

export async function ensureR2Bucket(cf: Cf, accountId: string, name: string): Promise<void> {
  try {
    const { buckets } = await cf<{ buckets: Array<{ name: string }> }>(
      `/accounts/${accountId}/r2/buckets`,
    );
    if (!buckets?.some((b) => b.name === name)) {
      await cf(`/accounts/${accountId}/r2/buckets`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
    }
  } catch (error) {
    if (!(error instanceof Error) || !error.message.toLowerCase().includes('already')) throw error;
  }
}

export interface AccessOptions {
  accountId: string;
  appName: string;
  controlHost: string;
  /** Wildcard for sibling site hosts, e.g. `*.sites.example.com`. */
  siteWildcard: string;
  /** Allow a single email, or a whole company domain. */
  allowEmail?: string | undefined;
  allowDomain?: string | undefined;
  /** Reuse an existing Zero Trust team domain when /access/organizations is unreadable. */
  teamDomainOverride?: string | undefined;
  /** Used only when creating a brand-new organization. */
  orgName?: string | undefined;
}

export interface AccessResult {
  teamDomain: string;
  policyAud: string;
  applicationId: string;
}

async function resolveTeamDomain(cf: Cf, opts: AccessOptions): Promise<string> {
  if (opts.teamDomainOverride) return new URL(opts.teamDomainOverride).hostname;
  try {
    const org = await cf<{ auth_domain?: string }>(
      `/accounts/${opts.accountId}/access/organizations`,
    );
    if (org.auth_domain) return org.auth_domain;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.toLowerCase().includes('not found'))
      throw error;
  }
  const created = await cf<{ auth_domain?: string }>(
    `/accounts/${opts.accountId}/access/organizations`,
    {
      method: 'POST',
      body: JSON.stringify({
        auth_domain: `${(opts.orgName || opts.appName).toLowerCase()}-${crypto.randomUUID().slice(0, 8)}.cloudflareaccess.com`,
        name: opts.orgName || opts.appName,
        session_duration: '24h',
      }),
    },
  );
  if (!created.auth_domain) throw new Error('Access API did not return an auth domain');
  return created.auth_domain;
}

export async function ensureAccessApp(cf: Cf, opts: AccessOptions): Promise<AccessResult> {
  const teamDomain = await resolveTeamDomain(cf, opts);
  const include = opts.allowDomain
    ? [{ email_domain: { domain: opts.allowDomain.toLowerCase() } }]
    : [{ email: { email: (opts.allowEmail || '').toLowerCase() } }];

  const existing = await cf<Array<{ id: string; name?: string; aud?: string }>>(
    `/accounts/${opts.accountId}/access/apps`,
  );
  let app = existing.find((a) => a.name === opts.appName);
  if (!app) {
    app = await cf<{ id: string; aud?: string }>(`/accounts/${opts.accountId}/access/apps`, {
      method: 'POST',
      body: JSON.stringify({
        name: opts.appName,
        type: 'self_hosted',
        // Keep the product/docs front door public. Access begins at the
        // publisher/API paths and covers every isolated site hostname.
        domain: `${opts.controlHost}/app`,
        session_duration: '24h',
        enable_binding_cookie: true,
        http_only_cookie_attribute: true,
        // Access authentication returns from <team>.cloudflareaccess.com.
        // Lax permits that top-level redirect while retaining CSRF protection.
        same_site_cookie_attribute: 'lax',
        destinations: [
          { type: 'public', uri: `${opts.controlHost}/app` },
          { type: 'public', uri: `${opts.controlHost}/api` },
          { type: 'public', uri: opts.siteWildcard },
        ],
        policies: [{ name: `${opts.appName} owner`, decision: 'allow', include }],
      }),
    });
  }
  if (!app.aud) throw new Error('Access API did not return an audience (AUD)');
  return { teamDomain, policyAud: app.aud, applicationId: app.id };
}

export async function resaveAccessApp(
  cf: Cf,
  accountId: string,
  applicationId: string,
  sameSite = 'lax',
): Promise<AccessResult> {
  const current = await cf<{
    id: string;
    aud?: string;
    name: string;
    type: string;
    domain: string;
    destinations?: Array<Record<string, unknown>>;
    policies?: Array<{ id?: string }>;
    allowed_idps?: string[];
    session_duration?: string;
    enable_binding_cookie?: boolean;
    http_only_cookie_attribute?: boolean;
    same_site_cookie_attribute?: string;
    app_launcher_visible?: boolean;
    auto_redirect_to_identity?: boolean;
    options_preflight_bypass?: boolean;
  }>(`/accounts/${accountId}/access/apps/${applicationId}`);
  const updated = await cf<{ id: string; aud?: string }>(
    `/accounts/${accountId}/access/apps/${applicationId}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        name: current.name,
        type: current.type,
        domain: current.domain,
        destinations: current.destinations,
        policies: current.policies?.map((policy) => policy.id).filter(Boolean),
        allowed_idps: current.allowed_idps,
        session_duration: current.session_duration,
        enable_binding_cookie: current.enable_binding_cookie,
        http_only_cookie_attribute: current.http_only_cookie_attribute,
        same_site_cookie_attribute: sameSite,
        app_launcher_visible: current.app_launcher_visible,
        auto_redirect_to_identity: current.auto_redirect_to_identity,
        options_preflight_bypass: current.options_preflight_bypass,
      }),
    },
  );
  if (!updated.aud) throw new Error('Access API did not return an audience after re-save');
  // The team domain is unchanged and is supplied by the caller's known configuration.
  return { teamDomain: '', policyAud: updated.aud, applicationId: updated.id };
}

export async function ensureWildcardDns(
  cf: Cf,
  accountId: string,
  zoneName: string,
  controlHost: string,
): Promise<void> {
  const zones = await cf<Array<{ id: string }>>(
    `/zones?name=${encodeURIComponent(zoneName)}&account.id=${accountId}`,
  );
  const zoneId = zones[0]?.id;
  if (!zoneId) throw new Error(`Zone ${zoneName} not found in account ${accountId}`);
  const name = `*.${controlHost}`;
  const existing = await cf<Array<{ id: string }>>(
    `/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}`,
  );
  if (existing.length) return;
  await cf(`/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'AAAA',
      name,
      content: '100::',
      proxied: true,
      comment: `${controlHost} site hosts`,
    }),
  });
}
