# Inhouse 0.0.1 initial release receipt

Commit: `46cbb566028d0eb24179238328bc475444726643`
Date: 2026-06-12

## Public product

- Repository: https://github.com/acoyfellow/inhouse
- Documentation and demo: https://inhouse.coey.dev
- Deploy button: redirects to Cloudflare Dashboard with `acoyfellow/inhouse`
- Docs Worker: `inhouse-site`, version `1f341265-99ed-4d43-a6ba-a592d2ee5a7c`
- Exposure: custom domain only; `workers.dev` and Preview URLs disabled

## Validation

- strict TypeScript: passed
- Workers Vitest runtime: 9 passed
- real local Durable Object and R2 flow: passed
- local Playwright browser E2E: passed
- local SEO/PWA audit: passed
- Wrangler dry run: passed
- public release secret/path scan: passed
- GitHub Actions: passed
- production SEO/PWA audit: passed
- production Playwright public-site pass: passed
- canonical route/link/content-type checks: passed

## Private product state

The personal-account Worker, Durable Object namespace, and private R2 bucket were provisioned. `inhouse-app` is deliberately staged with **no deployed target**, placeholder Access configuration, `workers_dev: false`, and Preview URLs disabled. Its attempted route deployment returned only fail-closed 503 responses and was removed immediately.

This is not yet an authenticated production receipt. The remaining gate is to create the personal account's Access organization/application, configure the exact issuer/audience, attach `app.inhouse.coey.dev` plus `*.inhouse.coey.dev`, then execute the authenticated publish and isolated anonymous-denial checks. No public fallback will be used to bypass that gate.
