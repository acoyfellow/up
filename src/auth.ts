import { createRemoteJWKSet, jwtVerify } from 'jose';
import { type Identity, roleFor } from './core';
export interface AccessConfiguration {
  TEAM_DOMAIN?: string;
  POLICY_AUD?: string;
  ADMIN_EMAILS?: string;
}
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export function configurationError(env: AccessConfiguration): string | null {
  if (
    !env.TEAM_DOMAIN ||
    !env.POLICY_AUD ||
    env.TEAM_DOMAIN.includes('REPLACE') ||
    env.POLICY_AUD.includes('REPLACE')
  )
    return 'Cloudflare Access is not configured';
  try {
    const url = new URL(env.TEAM_DOMAIN);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.cloudflareaccess.com'))
      return 'TEAM_DOMAIN must be an HTTPS cloudflareaccess.com hostname';
  } catch {
    return 'TEAM_DOMAIN is invalid';
  }
  return null;
}
function keySetFor(domain: string) {
  const cached = keySets.get(domain);
  if (cached) return cached;
  if (keySets.size >= 8) keySets.clear();
  const value = createRemoteJWKSet(new URL(`${domain}/cdn-cgi/access/certs`));
  keySets.set(domain, value);
  return value;
}
export async function verifyAccessIdentity(
  request: Request,
  env: AccessConfiguration,
): Promise<Identity> {
  const error = configurationError(env);
  if (error) throw new Error(error);
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) throw new Error('Authentication required');
  const domain = env.TEAM_DOMAIN as string;
  const audience = env.POLICY_AUD as string;
  const { payload } = await jwtVerify(token, keySetFor(domain), { issuer: domain, audience });
  if (typeof payload.email !== 'string' || !payload.email.trim())
    throw new Error('Access identity requires an email');
  const email = payload.email.trim().toLowerCase();
  return { email, role: roleFor(email, env.ADMIN_EMAILS) };
}
