# Up 0.0.1 Quick-parity review receipt — 2026-06-19

## Product slice

The review branch adds the fixed company-site capabilities identified from Shopify Quick:

- `up.identity`
- `up.db`
- `up.files`
- `up.ai`
- `up.realtime`

It also adds:

- `up init` agent bootstrap;
- `up deploy` CLI using the same manifest/upload/activation protocol as the browser;
- browser-mediated PKCE CLI authentication through the existing employee Access application;
- framework-free `examples/lunch-vote` using all five capabilities;
- removal of public/restricted visibility, Dynamic Worker, secret-management, schedule, and management UI surfaces.

## Alchemy v2

A source-only disposable spike used Alchemy v2 `2.0.0-beta.25`. It could type-check a Worker, assets, R2, and SQLite Durable Object graph, but not Workers AI or Access without custom providers. Alchemy was omitted because it increased the seven-minute source surface. See `2026-06-19-alchemy-v2-decision.md`.

## Temporary Deployment

Current Cloudflare Temporary Accounts were reviewed from the June 19 changelog and official claim-deployments documentation.

Temporary Accounts support Workers, Static Assets, KV, D1, Hyperdrive, Queues, and certificates. They do not currently support Durable Objects, R2, Workers AI, Access, custom domains, or wildcard routes.

A real unauthenticated temporary account was created with an isolated `HOME` and Wrangler `4.103.0`. No permanent Cloudflare credentials were used or changed.

Temporary deployment:

- Worker: `up-quick-parity-review`
- Version: `7c80cc6f-14aa-44b0-96c1-4b1535d8b356`
- Public SvelteKit SSR and Static Assets passed hydration and overflow checks.
- `/reference` exposed the fixed capability contracts.
- `/app` failed closed with `503 Cloudflare Access is not configured`, as expected for unsupported Access.
- The sensitive claim URL was not committed or shared.
- The temporary account expires automatically after 60 minutes.

This temporary deployment does not claim to validate unsupported capability bindings.

## Full capability evidence

The full runtime was verified with the Workers Vitest pool and an employee-protected AX installation before the temporary-deployment-only freeze:

- site-isolated document collections;
- site-isolated files;
- Workers AI response;
- two authenticated WebSocket clients receiving the same vote;
- anonymous Access challenge before content;
- CLI PKCE broker without Access writes, Cloudflare API tokens, cookie import, or a second Access application.

The live proof site was `https://lunch-vote.up.ax.cloudflare.dev`.

## Safety correction

An attempted OAuth consent screen requesting `access.write` was canceled before authorization. No OAuth credential was created and Access remained unchanged. The CLI now uses a short-lived Up-issued deploy token after browser authentication through `/app/cli-auth`.

After the user required Temporary Deployments, the recurring loop was replaced and no further production deployment was allowed. Promotion of the review branch requires explicit approval.

## Video

`demo/up-0.0.1.mp4` is a 14-second H.264 proof assembled from real cmux browser frames. It shows identity, voting/database state, file storage, AI summary, and the authenticated site. cmux WKWebView native screencast is unsupported, so timed real frames are encoded with ffmpeg.
