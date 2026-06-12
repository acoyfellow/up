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
- production Lighthouse: 100 performance / 100 accessibility / 100 best practices / 100 SEO
- canonical route/link/content-type checks: passed
- self-hosted Inter and IBM Plex Mono; no third-party font request

## Private product state

The private R2 bucket was provisioned. A personal-account `inhouse-app` Worker was used to verify production routing behavior: its attempted route deployment returned only fail-closed 503 responses. Because the available API token cannot create Access applications, the Worker and every app/site route were then deleted rather than leave a binding-bearing public target. `workers.dev` and Preview URLs were never enabled.

This is not yet an authenticated production receipt. The remaining gate is to create the personal account's Access organization/application, configure the exact issuer/audience, attach `app.inhouse.coey.dev` plus `*.inhouse.coey.dev`, then execute the authenticated publish and isolated anonymous-denial checks. No public fallback will be used to bypass that gate.
