# Up SvelteKit SSR migration receipt — 2026-06-19

## Change

Up's custom Hono + `svelte-hono` rendering layer was replaced with SvelteKit and `@sveltejs/adapter-cloudflare`.

- Public pages and documentation are filesystem routes under `src/routes`.
- Canonical, description, robots, Open Graph, Twitter, and JSON-LD metadata render through `src/lib/SEO.svelte`.
- `src/hooks.server.ts` verifies the Access identity before rendering `/app`.
- `src/routes/app/+page.server.ts` loads identity and site summaries before SSR.
- The first authenticated HTML response contains the authoritative identity and site list; it does not render the empty publisher state first.
- Existing control APIs, session broker, wildcard site serving, R2, Durable Objects, Dynamic Workers, secrets, schedules, and visibility contracts remain in `src/core-backend.ts`.

## Cloudflare routing boundary

The outer `src/kit-worker.ts` dispatches `/api/*`, `/app/__session`, and wildcard site hostnames before invoking SvelteKit. Static assets use a separate `STATIC_ASSETS` binding with `run_worker_first: true`.

This ordering is required so paths such as `/icon.svg` or `/_app/...` on a published-site hostname resolve through that site's deployment rather than Up's own static asset manifest.

## Deployment

- Source commit: `e9447ee` — `Migrate Up frontend to SvelteKit SSR`
- Worker version: `3977a74a-ce4e-4bdf-9120-80661fa3fb97`
- Access application, policy, IdP, routes, R2, Durable Object classes, Worker Loader, secrets, and minute schedule were preserved.
- `workers.dev` and preview URLs remain disabled.

## Verification

- SvelteKit build and Cloudflare adapter: passed.
- Svelte check: zero errors and zero warnings.
- TypeScript: passed.
- Workers runtime tests: 27/27 passed.
- Biome and diff checks: passed.
- Baseline fixture: passed.
- Local SEO/PWA audit: passed.
- Local browser E2E: passed with JavaScript enabled and disabled.
- SSR unit test proves identity/site data renders in first HTML and uses `private, no-store`.
- Production homepage raw HTML contains title, description, canonical, JSON-LD, and the complete H1.
- Production homepage hydrates with no browser errors and zero horizontal overflow.
- Anonymous `/app` and `/api/me` remain intercepted by Access.
- Authenticated raw `/app` HTML contains `jcoeyman@cloudflare.com`, `baseline`, and `dynamic-e2e`; it does not contain the empty `Publish a site` state.
- Authenticated publisher hydrates directly to `Your sites` with both sites, no empty-state flash, no browser errors, and zero overflow.
- Anonymous wildcard probes for `/`, `/icon.svg`, and `/_app/immutable/assets/...` return only the private session-broker redirect with zero content bytes.
- A fresh post-deploy Access export still reports `Cloudflare employees`, `@cloudflare.com`, and MyIdentity SAML with unchanged `updated_at: 2026-06-18T21:42:33Z`.
- The post-deploy Access release guard passed.
