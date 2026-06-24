# Security

Report vulnerabilities privately through GitHub Security Advisories for `acoyfellow/up`. Do not file public issues for suspected exposure.

Up is an independent experiment, not an official Cloudflare product.

## Anonymous mode

The default command creates an intentionally public, disposable deployment:

```sh
up deploy <folder> [name]
```

There is no Access policy and no viewer authentication. Anyone with the generated `workers.dev` URL can read the assets and call the Worker API until the account expires or the owner changes the deployment after claiming it.

Dynamic code receives the Temporary Account bindings declared in `up.json`. It can mutate KV, D1, and Durable Object state and consume the bounded resources available to that account. Review `_worker.js` as executable server code, not as a static asset.

Do not deploy:

- credentials, API tokens, private keys, or `.env` files;
- customer or employee data;
- private source maps;
- internal documents;
- anything that should not be public for the next hour.

Up rejects missing `index.html`, assets above 5 MiB, folders above 1,000 assets, symbolic links, special files, sensitive dotfiles, unknown manifest fields, and unsupported bindings. It snapshots files through no-follow handles before invoking Wrangler. It does not currently perform malware, phishing, copyright, semantic code, or comprehensive secret scanning. Cloudflare applies separate abuse controls.

## Credential isolation

Anonymous mode starts pinned Wrangler with an isolated home and config directory under:

```text
~/.up/anonymous
```

Up removes current and deprecated Cloudflare credential variables from the Wrangler child process, including:

- `CLOUDFLARE_API_TOKEN` / `CF_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID` / `CF_ACCOUNT_ID`
- `CLOUDFLARE_API_KEY` / `CF_API_KEY`
- `CLOUDFLARE_EMAIL` / `CF_EMAIL`
- `CLOUDFLARE_API_USER_SERVICE_KEY`

This is a safety boundary: `up deploy` must not silently deploy into a developer's authenticated account. The state directories are mode `0700`; Wrangler writes temporary account state as mode `0600`.

Wrangler—not Up—performs proof of work, temporary-account provisioning, supported resource provisioning, upload, and claim handoff. Up wraps the documented `wrangler deploy --temporary` command instead of calling the unpublished provisioning API directly.

Interactive Wrangler prompts for Cloudflare's Terms and Privacy Policy. Non-interactive Up requires `--accept-cloudflare-terms` or `UP_ACCEPT_CLOUDFLARE_TERMS=yes`; an agent must receive human approval before using either.

## Claim URL

The claim URL is an ownership capability for the **whole temporary account**, not just one Worker.

Anyone who receives it may be able to claim every deployment and supported resource created in the active anonymous Up session. Treat it like a password:

- do not commit it;
- do not include it in screenshots, videos, CI logs, telemetry, or issue reports;
- do not send it to unrelated agents or people;
- do not put it in shell arguments or filenames;
- use it within about 60 minutes.

`up claim --open` reads the current local claim metadata and opens the Cloudflare dashboard flow. Up does not claim an account itself or confirm post-claim ownership.

## Expiry and durability

Unclaimed Temporary Accounts are documented to expire after about 60 minutes. Their Workers and supported resources are deleted. Do not use anonymous mode for production, CI/CD, backups, or durable data.

Cloudflare rate-limits account creation and applies additional undisclosed abuse checks. Deployment may fail even when local validation passes.

## Company mode

The retained secondary command:

```sh
up private <folder> <name> --origin <installation>
```

uses the original customer-owned, Access-protected installation. Its trust model is separate:

- the control API verifies Access identity;
- a sibling-domain signed session gates site bytes and capabilities;
- R2 remains private;
- site scope comes from the hostname after authentication;
- browser code receives no Cloudflare credentials;
- deployment assets remain pending until size and SHA-256 verification succeeds;
- activation changes one registry pointer.

Company mode must keep `workers_dev: false`, preview URLs disabled, private R2, and an Access policy with no Everyone or Bypass rule. Production mutation remains a separate explicitly approved operation.

## Release checks

Before merging anonymous-mode changes:

```sh
bun run check
bun run test:e2e
```

Ordinary CI must not create a live Temporary Account. Live anonymous smoke tests are manual, use isolated state, redact the claim URL, and delete local temporary credentials afterward.
