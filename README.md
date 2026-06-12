# Inhouse

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/acoyfellow/inhouse)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Your company’s private web, on your Cloudflare account.**

Inhouse publishes folders of HTML, CSS, JavaScript, and assets at company-private URLs. An organization installs it once; employees and coding agents can then share small sites without creating infrastructure or configuring authentication for every artifact.

```text
folder → immutable private upload → Access-authenticated URL
```

**Version:** `0.0.1` · **Dogfood:** <https://inhouse.coey.dev>

## Deploy

1. Click **Deploy to Cloudflare** above. The button provisions one Worker, one SQLite-backed Durable Object namespace, and one private R2 bucket in your account.
2. Before enabling a production route, create a Cloudflare Access application covering both:

   ```text
   inhouse.example.com
   *.inhouse.example.com
   ```

3. Configure the Worker:

   ```text
   TEAM_DOMAIN=https://your-team.cloudflareaccess.com
   POLICY_AUD=<Access application audience>
   ADMIN_EMAILS=you@example.com
   CONTROL_HOST=inhouse.example.com
   SITE_DOMAIN=inhouse.example.com
   ```

4. Attach the control hostname and wildcard site route. Disable `workers.dev` and Preview URLs.
5. Open `https://inhouse.example.com/app`, choose a folder containing `index.html`, and publish.

For a reproducible setup, `bun run access:provision` creates the Access organization/application and exact-email allow policy when supplied an API token with **Access Apps and Policies Write**. `bun run test:production` then performs the authenticated publish and isolated anonymous-denial receipt.

The portable button deployment intentionally fails closed until Access is configured. **Do not make the Worker public to finish setup.** Deploy to Cloudflare does not yet provision the wildcard Access application safely on your behalf.

## What publishing does

1. The browser hashes every file locally and declares a bounded manifest.
2. Inhouse creates a pending immutable deployment in its Durable Object.
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

The same documentation is published at <https://inhouse.coey.dev>.

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

Inhouse is permanently minimal at `0.0.1`. It supports static folders, organization-wide reading, creator/admin publishing, immutable deployments, and atomic activation. Public sites, arbitrary backend code, per-recipient ACLs, server-side secrets, databases, and scheduled jobs are intentionally out of scope.

## License

MIT © Jordan Coeyman.
