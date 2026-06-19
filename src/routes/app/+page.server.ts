import { error } from '@sveltejs/kit';
import type { SiteRecord } from '../../core';
import { handleAuthenticatedRequest } from '../../core-backend';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform, request, setHeaders, url }) => {
  if (!locals.identity) throw error(403, 'Authentication required');
  if (!platform?.env) throw error(503, 'Cloudflare bindings are unavailable');
  setHeaders({ 'cache-control': 'private, no-store' });

  const apiUrl = new URL('/api/sites', url);
  const response = await handleAuthenticatedRequest(
    new Request(apiUrl, { headers: request.headers }),
    platform.env,
    locals.identity,
  );
  if (!response.ok) throw error(response.status, 'Unable to load sites');

  const body = await response.json<{ sites: SiteRecord[]; siteDomain: string | null }>();
  return {
    identity: locals.identity,
    sites: body.sites,
    siteDomain: body.siteDomain || platform.env.SITE_DOMAIN || 'up.example.com',
  };
};
