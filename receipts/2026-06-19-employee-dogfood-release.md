# Up employee-dogfood release receipt — 2026-06-19

## Release shape

- Public product front door: `https://up.ax.cloudflare.dev/`
- Employee-protected publisher: `https://up.ax.cloudflare.dev/app`
- Customer-neutral product language throughout the publisher.
- Public homepage presents Up as an installable product and includes one quiet qualifier: Cloudflare's hosted installation is currently available to Cloudflare employees.
- Rejected “Put it up”/“It's up” copy was removed from the active product flow.

## Access boundary

A fresh read-only Access application export was checked before and after deployment.

- Application: `f3ee40d0-acd4-4bd6-ad02-16b7d23d9a32`
- Policy: `Cloudflare employees`
- Include rule: email domain `cloudflare.com`
- Identity provider: MyIdentity SAML (`fb771016-753f-4bce-9d2c-082479673f95`)
- Protected destinations: `up.ax.cloudflare.dev/app` and `up.ax.cloudflare.dev/api`
- Binding cookie and HttpOnly enabled; SameSite=Lax.
- No Everyone or Bypass policy.
- Access configuration timestamp remained `2026-06-18T21:42:33Z`; the Worker deployments did not modify Access.

The new `release:access:check` guard rejects Everyone, Bypass, unreviewed IdPs, missing protected destinations, and weakened cookie settings. The AX deployment command runs this guard before Wrangler.

## Deployment

- Release commit: `929b056` — `Prepare employee-only Up release`
- Hydration fix: `fd0c65d` — `Fix Svelte browser hydration`
- Final Worker version: `a9f9828a-97a3-471a-92bc-544795fdbf83`
- Routes: apex custom domain and wildcard site route.
- Cron: every minute.
- Bindings restored: registry, site database, site secrets, private R2, Worker Loader, Access configuration, and limits.
- `workers.dev` and preview URLs remained disabled.

## Verification

- Build and TypeScript: passed.
- Baseline fixture: passed.
- Workers runtime tests: 24/24 passed.
- Biome and diff checks: passed.
- Local SEO/PWA audit: passed.
- Local browser E2E: passed with explicit hydration-error capture.
- Desktop and mobile: zero horizontal overflow.
- Public homepage: `200`, public cache revalidation, expected product copy and qualifier.
- Anonymous `/app`, `/api/me`, and `/api/sites`: Access redirect with no-store response.
- Anonymous `baseline.up.ax.cloudflare.dev`: zero-byte redirect to the protected session broker.
- Authenticated `/api/me`: `jcoeyman@cloudflare.com`, admin.
- Authenticated `/api/sites`: preserved `baseline` and `dynamic-e2e` registry records.
- Authenticated publisher: hydrated with no browser errors and rendered both preserved sites.
- Read-only Manage transition for `baseline`: interactive and error-free.
- Public `workers.dev` and guessed preview hosts: `404`/unresolvable.

The first restoration version exposed a Svelte bare-import hydration error while preserving SSR and all security boundaries. It was immediately superseded by the final version above. The fix adds Svelte's compatibility flag module to the shared import map and makes browser E2E fail on hydration errors.
