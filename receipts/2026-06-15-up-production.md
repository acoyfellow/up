# Up production E2E receipt — 2026-06-15

## Installation

- Control plane: `https://up.ax.cloudflare.dev`
- Site shape: `https://<name>.up.ax.cloudflare.dev`
- `up.ax.cloudflare.dev` is an isolated active child zone delegated from `ax.cloudflare.dev`.
- Parent-zone mutation is limited to two NS records for the `up` label.
- Worker: `up`; `workers.dev` and Preview URLs disabled.
- Storage: private R2 bucket and SQLite Durable Object binding.
- Access app and audience were created, re-associated, injected, and deployed by `bun run setup`; no AUD was created or copied manually.

## Authenticated publish

Using the authenticated cmux in-app browser as `jcoeyman@cloudflare.com`:

1. Opened `/app`; Up returned the existing-site list and authenticated identity.
2. Selected `examples/baseline-site` (5 files, valid `index.html`).
3. Published site name `baseline`.
4. Received the Up success receipt: **“It’s up.”**
5. Opened `https://baseline.up.ax.cloudflare.dev`.
6. Verified rendered HTML, CSS, JavaScript, SVG, text asset, and `/__up/me`.
7. Verified `/baseline.txt` returned `UP_BASELINE_OK`.

All deployed responses now use `Cache-Control: private, no-cache`. This prevents stable asset URLs from retaining bytes from a superseded atomic deployment.

## Isolated anonymous denial

A cookie-free curl request was made for each path:

- `/`
- `/baseline.txt`
- `/assets/site.css`
- `/assets/site.js`
- `/assets/mark.svg`
- `/__up/me`

Every request completed a valid TLS handshake and returned `302` to Cloudflare Access. No uploaded bytes were available anonymously.

## Verification

- `bun run check`: passed
- `bun run test:e2e`: passed
- `bun run site:audit`: passed
- `bun run public:check`: passed
- `bun run dry-run`: passed
- Workers Vitest: 9/9 passed
- Desktop, selected-folder, and 390×844 mobile states reviewed
