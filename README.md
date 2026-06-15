# Up

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/acoyfellow/inhouse)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Put your company’s private web online, on your Cloudflare account.**

Up turns folders of HTML, CSS, JavaScript, and assets into company-private URLs. An organization connects Cloudflare once; employees and coding agents can then share small sites without creating infrastructure or configuring authentication for every artifact.

```text
folder → immutable private upload → Access-authenticated URL
```

**Version:** `0.0.1` · **Dogfood:** <https://up.ax.cloudflare.dev>

## Deploy

Up uses Cloudflare OAuth. You approve a scoped consent screen; no API token or Access audience is created or copied by hand.

```sh
export INHOUSE_OAUTH_CLIENT_ID=<client id>
bun run oauth:connect

export CLOUDFLARE_ACCOUNT_ID=<account id>
export INHOUSE_CONTROL_HOST=up.example.com
export INHOUSE_PARENT_ZONE=example.com
export INHOUSE_ALLOWED_DOMAIN=example.com
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
5. Site requests validate the Cloudflare Access JWT before reading private R2.

Visitors see either the prior complete deployment or the new complete deployment—never a partial upload.

## Security invariant

> A URL is never authorization, and a deployment is not done until an isolated unauthenticated request proves uploaded content is unavailable.

- All control and site reads validate Access signature, issuer, audience, and email.
- Missing or placeholder Access configuration fails closed.
- R2 has no public object URLs.
- Production disables `workers.dev` and Preview URLs.
- Site creators and configured administrators can mutate a site.
- Cross-site control mutations are rejected using exact-origin and Fetch Metadata checks.
- Generated site code runs on sibling hostnames and receives no Worker bindings or secrets.
- Site names, deployment IDs, hashes, and object keys grant no authority.

Read [SECURITY.md](SECURITY.md) before attaching a real company hostname.

## Repository map

| Path | Purpose |
|---|---|
| `src/` | Access validation, Worker routes, deployment authority, R2 serving |
| `src/site.svelte` | SEO/PWA docs, demo, and authenticated publisher |
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

The dogfood installation is available at <https://up.ax.cloudflare.dev> behind Cloudflare Access.

## Local verification

There is intentionally no local authentication bypass.

```sh
bun install
bun run build
bun run typecheck
bun run test
bun run dry-run
```

The test suite executes the real Worker, SQLite-backed Durable Object, and R2 implementation under Cloudflare’s Workers Vitest pool. It proves manifest validation, digest enforcement, partial-upload rejection, ownership, atomic activation, content serving, and anonymous denial.

For a stable manual publish fixture, choose [`examples/baseline-site`](examples/BASELINE.md). It exercises nested CSS, JavaScript, SVG, a text asset, and the authenticated identity endpoint without external dependencies.

For the browser pass:

```sh
bun run dev
bun run test:e2e
```

The local browser pass audits the public docs/PWA and confirms protected endpoints fail closed. The authenticated publish flow is verified only against an actual Access-protected deployment.

## Production done gate

A release is done only after all of these are recorded:

- local build, typecheck, runtime tests, dry run, browser test, SEO/PWA audit;
- deployment watched to success;
- public docs and every canonical link checked;
- authenticated folder publish succeeds;
- returned site renders HTML and assets;
- `/__inhouse/me` returns the authenticated Access identity;
- a clean isolated browser is challenged by Access and never receives uploaded bytes;
- update and atomic activation are verified;
- deployment receipt records git SHA, route exposure, bindings, and the checks above.

## Status

Up is permanently minimal at `0.0.1`. It supports static folders, organization-wide reading, creator/admin publishing, immutable deployments, and atomic activation. Public sites, arbitrary backend code, per-recipient ACLs, server-side secrets, databases, and scheduled jobs are intentionally out of scope.

## License

MIT © Jordan Coeyman.
