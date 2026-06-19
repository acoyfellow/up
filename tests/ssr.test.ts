import { env } from 'cloudflare:test';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/core-backend';
import { load } from '../src/routes/app/+page.server';
import Site from '../src/site.svelte';

describe('SvelteKit publisher SSR', () => {
  it('loads product state on the server with private cache headers', async () => {
    const headers = new Headers();
    const data = await load({
      locals: { identity: { email: 'owner@example.com', role: 'member' } },
      platform: { env: env as unknown as Env },
      request: new Request('https://control.example.com/app'),
      setHeaders(values: Record<string, string>) {
        for (const [name, value] of Object.entries(values)) headers.set(name, value);
      },
      url: new URL('https://control.example.com/app'),
    } as never);

    expect(data).toMatchObject({
      identity: { email: 'owner@example.com', role: 'member' },
      siteDomain: 'up.example.com',
    });
    expect(headers.get('cache-control')).toBe('private, no-store');
  });

  it('renders authoritative identity and sites in the first HTML response', () => {
    const result = render(Site, {
      props: {
        section: 'app',
        eyebrow: 'Control plane · authenticated publisher',
        initialIdentity: 'employee@example.com',
        initialSiteDomain: 'up.example.com',
        initialSites: [
          {
            name: 'quarterly-report',
            owner: 'employee@example.com',
            activeDeploymentId: 'deployment-id',
          },
        ],
        productLoaded: true,
      },
    });

    expect(result.body).toContain('employee@example.com');
    expect(result.body).toContain('quarterly-report.up.example.com');
    expect(result.body).toContain('Company · Published');
    expect(result.body).not.toContain('Publish a site.</h1>');
  });
});
