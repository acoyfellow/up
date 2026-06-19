# Up

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/acoyfellow/up)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Publish your company’s private web from your Cloudflare account.**

Up turns folders of HTML, CSS, JavaScript, and assets into company-private URLs. An organization connects Cloudflare once; employees and coding agents can then share small sites without creating infrastructure or configuring authentication for every artifact.

```text
folder → immutable private upload → Access-authenticated URL
```

**Version:** `0.0.1` · **Dogfood:** <https://up.ax.cloudflare.dev>

## Deploy

Up uses Cloudflare OAuth. You approve a scoped consent screen; no API token or Access audience is created or copied by hand.

```sh
export UP_OAUTH_CLIENT_ID=<client id>
bun run oauth:connect

export CLOUDFLARE_ACCOUNT_ID=<account id>
export UP_CONTROL_HOST=up.example.com
export UP_PARENT_ZONE=example.com
export UP_ALLOWED_DOMAIN=example.com
bun run setup
```

`bun run setup` creates an isolated child zone when requested, delegates only the control hostname, creates private R2 and the Access application, reads back its generated AUD, injects it into a gitignored deploy config, and deploys the Worker. `workers.dev` and Preview URLs remain disabled.

Open `https://up.example.com/app`, choose a folder containing `index.html`, and publish. Sites appear at `<name>.up.example.com` behind the same company Access boundary.

The portable deployment fails closed until Access is configured. **Do not make the Worker public to finish setup.**

## What publishing does

1. The browser hashes every file locally and declares a bounded manifest.
2. Up creates a pending immutable deployment in its Durable Object.
3. Each uploaded R2 object must match the declared path, size, and SHA-256 digest.
4. Activation verifies every object, then atomically swaps the active deployment pointer.
5. Site requests enforce explicit visibility: public, company session, or restricted reader rules.

Visitors see either the prior complete deployment or the new complete deployment—never a partial upload.

## Security invariant

> A URL never grants private authority, and a deployment is not done until an isolated probe proves its declared visibility.

- Control routes validate the Access signature, issuer, audience, and email.
- Company/restricted sites require an HMAC-signed session minted by the Access-protected broker.
- Public serving requires explicit registry state; absence of identity never implies public.
- Missing Access or session configuration fails closed for non-public sites.
- R2 has no public object URLs.
- Production disables `workers.dev` and Preview URLs.
- Site creators and configured administrators can mutate a site.
- Cross-site control mutations are rejected using exact-origin and Fetch Metadata checks.
- Browser code runs on sibling hostnames. Optional backend code receives only explicitly enabled, site-scoped capability stubs.
- Site names, deployment IDs, hashes, and object keys grant no authority.

Read [SECURITY.md](SECURITY.md) before attaching a real company hostname.

## Repository map

| Path | Purpose |
|---|---|
| `src/routes/` | SvelteKit SSR pages, server loads, metadata, and authenticated publisher route |
| `src/core-backend.ts` | Access validation, control APIs, deployment authority, and wildcard site serving |
| `src/site.svelte` | Shared product and publisher interface, initialized from SvelteKit server data |
| `tests/` | Real Workers runtime, Durable Object, and R2 integration tests |
| `fixtures/` | Static site used by the end-to-end verification path |
| `docs/` | Diátaxis documentation |
| `wrangler.jsonc` | Portable Deploy to Cloudflare resources; fail-closed defaults |
| `wrangler.production.jsonc` | Dogfood route shape; placeholders must be replaced before deploy |

## Documentation

- [Tutorial](docs/tutorial/index.md) — install and publish a first site
- [How-to guides](docs/how-to/index.md) — operate and recover an installation
- [Reference](docs/reference/index.md) — exact routes, limits, and configuration
- [Explanation](docs/explanation/index.md) — architecture and trust boundaries

The product front door is public at <https://up.ax.cloudflare.dev>; the dogfood publisher and control APIs remain behind Cloudflare Access.

## Local verification

There is intentionally no local authentication bypass.

```sh
bun install
bun run build
bun run typecheck
bun run test
bun run dry-run
```

The test suite executes the real Worker, SQLite-backed Durable Objects, R2, session broker, capability stores, scheduler, and Dynamic Worker boundary under Cloudflare’s Workers Vitest pool. It proves visibility rules, digest enforcement, atomic activation, runtime limits, database isolation, encrypted secret metadata, schedule quotas/retries, public serving, and anonymous denial.

For a stable manual publish fixture, choose [`examples/baseline-site`](examples/BASELINE.md). It exercises nested CSS, JavaScript, SVG, a text asset, and the authenticated identity endpoint without external dependencies.

For the browser pass:

```sh
bun run dev
bun run test:e2e
```

The local browser pass audits SvelteKit SSR with JavaScript enabled and disabled, validates SEO/PWA metadata, and confirms protected endpoints fail closed. The authenticated publish flow is verified only against an actual Access-protected deployment.

## Production done gate

A release is done only after all of these are recorded:

- local build, typecheck, runtime tests, dry run, browser test, SEO/PWA audit;
- deployment watched to success;
- public docs and every canonical link checked;
- authenticated folder publish succeeds;
- returned site renders HTML and assets;
- `/__up/me` returns the authenticated Access identity;
- a clean isolated browser is challenged by Access and never receives uploaded bytes;
- update and atomic activation are verified;
- deployment receipt records git SHA, route exposure, bindings, and the checks above.

## Status

Up `0.0.1` is static and company-private by default, with explicit progressive capabilities:

- **Visibility:** company, restricted email/domain/IdP-group readers, or confirmed public access
- **Backend:** an optional root `_worker.js` executes `/api/*` in a network-isolated Dynamic Worker
- **Secrets:** encrypted, write-only bearer capabilities restricted to exact outbound hosts
- **Data:** an isolated per-site SQLite Durable Object, enabled and deleted by the owner
- **Schedules:** bounded UTC jobs with daily quotas, retries, pause/disable behavior, and audit receipts

Dynamic code never runs in the Up control isolate and never receives the registry, deployment authority, private R2 bucket, encryption keys, or another site's bindings.

## License

MIT © Jordan Coeyman.
