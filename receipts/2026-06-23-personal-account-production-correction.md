# Production account correction — 2026-06-23

## Incident

After PR #2 merged, `wrangler.up.jsonc` was used for deployment. That ignored local config still targeted the AX account and `up.ax.cloudflare.dev`. This was the wrong account for the independent Up project.

## Immediate correction

- Mistaken AX Worker version: `72eeb31c-1312-4058-b085-e44551a16e36`.
- AX was immediately rolled back to its prior Worker version:
  `02a705aa-ac90-4c9d-a636-51b80af43db6` at 100% traffic.
- Rollback did not modify bound R2, Durable Object, DNS, route, or Access resources.
- The ignored AX config `wrangler.up.jsonc` was deleted.

## Personal production

- Account: `Coeyman@gmail.com's Account`
- Account ID: `bfcb6ac5b3ceaf42a09607f6f7925823`
- Worker: `up-coey-dev`
- Domain: `https://up.coey.dev`
- Personal version deployed: `cd4d0def-35ba-47d6-8f23-cf231cce715a`
- Personal Access app: `up-coey-dev`
- Personal Access domain: `up.coey.dev/app`
- Allow policy: exact identity `coeyman@gmail.com`

Production checks:

- homepage: HTTP 200;
- headline: `Your app is live before you sign up.`;
- native catalog: 8 Temporary Account primitives;
- Capa catalog: 14 bindings;
- canonical: `https://up.coey.dev/`;
- `/app` and `/api/sites`: redirect to `coeyman.cloudflareaccess.com`.

## Permanent guardrails

- `wrangler.jsonc` and `wrangler.production.jsonc` both pin the personal account ID.
- Both configs target only `up-coey-dev`, `up.coey.dev`, `*.up.coey.dev`, and personal bindings.
- AX-specific deploy scripts and ignored Wrangler paths were removed.
- `public:check` fails if an AX account ID, hostname, tenant, or AUD prefix appears outside historical receipts.
- Active site metadata, sitemap, robots, CLI defaults, and production tests use `up.coey.dev`.
