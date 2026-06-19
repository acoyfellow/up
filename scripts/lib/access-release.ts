type AccessRule = Record<string, Record<string, unknown>>;

type AccessPolicy = {
  decision?: string;
  include?: AccessRule[];
  exclude?: AccessRule[];
  require?: AccessRule[];
  name?: string;
};

export type AccessApplicationSnapshot = {
  id?: string;
  name?: string;
  allowed_idps?: string[];
  auto_redirect_to_identity?: boolean;
  destinations?: Array<{ type?: string; uri?: string }>;
  policies?: AccessPolicy[];
  enable_binding_cookie?: boolean;
  http_only_cookie_attribute?: boolean;
  same_site_cookie_attribute?: string;
};

export type AccessReleaseExpectation = {
  applicationId: string;
  identityProviderId: string;
  emailDomain: string;
  controlHost: string;
};

function hasRule(rules: AccessRule[] | undefined, key: string): boolean {
  return (rules || []).some((rule) => Object.hasOwn(rule, key));
}

export function validateAccessRelease(
  app: AccessApplicationSnapshot,
  expected: AccessReleaseExpectation,
): string[] {
  const errors: string[] = [];
  const policies = app.policies || [];
  const allowPolicies = policies.filter((policy) => policy.decision === 'allow');

  if (app.id !== expected.applicationId) errors.push('Access application ID does not match');
  if (app.name?.toLowerCase() !== 'up') errors.push('Access application name must be Up');
  if (app.allowed_idps?.length !== 1 || app.allowed_idps[0] !== expected.identityProviderId)
    errors.push('Access must allow only the reviewed identity provider');
  if (app.auto_redirect_to_identity !== true)
    errors.push('Access must redirect directly to the reviewed identity provider');

  if (allowPolicies.length !== 1) errors.push('Access must have exactly one allow policy');
  for (const policy of policies) {
    if (hasRule(policy.include, 'everyone'))
      errors.push('Access policy must never include Everyone');
    if (policy.decision === 'bypass') errors.push('Access policy must never bypass authentication');
  }

  const allow = allowPolicies[0];
  const include = allow?.include || [];
  if (
    include.length !== 1 ||
    include[0]?.email_domain?.domain !== expected.emailDomain.toLowerCase()
  )
    errors.push(`Allow policy must be limited to @${expected.emailDomain.toLowerCase()}`);

  const expectedDestinations = new Set([
    `${expected.controlHost}/app`,
    `${expected.controlHost}/api`,
  ]);
  const actualDestinations = new Set(
    (app.destinations || [])
      .filter((destination) => destination.type === 'public' && destination.uri)
      .map((destination) => destination.uri as string),
  );
  for (const destination of expectedDestinations)
    if (!actualDestinations.has(destination))
      errors.push(`Access destination is missing: ${destination}`);

  if (app.enable_binding_cookie !== true) errors.push('Access binding cookie must remain enabled');
  if (app.http_only_cookie_attribute !== true) errors.push('Access cookie must remain HttpOnly');
  if (app.same_site_cookie_attribute !== 'lax')
    errors.push('Access cookie SameSite setting must remain Lax');

  return [...new Set(errors)];
}
