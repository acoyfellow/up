# Security

Report vulnerabilities privately through GitHub Security Advisories for `acoyfellow/up`. Do not file public issues for suspected exposure.

## Trust model

The product homepage and documentation are public, contain no customer data, and read no private bindings.

The publisher and control APIs require Cloudflare Access at:

```text
<control-host>/app
<control-host>/api
```

Up independently verifies the Access JWT signature, issuer, audience, and email before control-plane reads or mutations. The protected session broker at `/app/__session` converts that identity into an eight-hour HMAC-signed, HttpOnly, Secure, SameSite=Lax sibling-domain session.

Site visibility is registry authority:

- **company** — any valid company session; this is the default
- **restricted** — owner/admin or a matching email, domain, or trusted IdP group
- **public** — explicit anonymous serving

Restricted denials return `404`. Public mode is never inferred from a URL or missing identity.

## Untrusted content and code

Uploaded browser code and optional backend code are untrusted. Browser content runs on sibling site hostnames, never the control origin. State-changing control requests require the exact origin and same-site Fetch Metadata.

A root `_worker.js` executes `/api/*` in a separate Dynamic Worker isolate:

- no Up registry, R2 bucket, deployment authority, or encryption keys
- global outbound network blocked
- 50 ms CPU and 5 subrequests per invocation
- 1 MiB code limit
- no response cookies
- generic errors without source, stack, or logs

Optional capabilities are narrow:

- **Database:** one site-specific SQLite Durable Object stub; the namespace is never provided.
- **Secrets:** AES-256-GCM ciphertext in a site-specific Durable Object. Dynamic code cannot read values; it can request an allowlisted HTTPS operation where trusted code injects the bearer credential. Returned text is bounded and direct secret occurrences are redacted.
- **Schedules:** trusted minute scheduler with atomic leases, UTC quotas, exponential retries, pause/disable states, and bounded audit receipts.

## Production requirements

- Create Access before attaching `/app` and `/api` routes.
- Do not gate the public documentation or rely on an Access Bypass policy.
- Keep new sites `company` unless the owner explicitly chooses otherwise.
- Mint site sessions only through the protected broker and use a cryptographically generated `SESSION_SECRET`.
- Generate `SECRETS_KEY` as 32 random bytes and store it only as a Worker secret and a mode-600 local recovery file.
- Keep R2 private and expose no direct object URL.
- Keep `workers_dev: false` and `preview_urls: false`.
- Verify public reachability only for explicitly public sites.
- Verify anonymous denial for company/restricted sites after every routing or Access change.
- Treat site names, deployment IDs, object keys, and URLs as public identifiers—not capabilities.

Before restoring the AX reference installation, export a fresh read-only Access application snapshot and run `bun run release:access:check` with `UP_ACCESS_APPLICATION_FILE`, `UP_EXPECTED_ACCESS_APP_ID`, `UP_EXPECTED_ACCESS_IDP`, `UP_EXPECTED_EMAIL_DOMAIN`, and `UP_CONTROL_HOST`. The guard fails if it finds an Everyone or Bypass policy, an unreviewed IdP, missing `/app` or `/api` destinations, or weakened cookie settings. `bun run deploy:up:safe` runs this guard before deployment and never modifies Access.

## Installation boundary

`bun run setup` provisions or reuses the child zone, DNS, private R2, Access application, Worker Loader, Durable Objects, scheduler, session secret, and encryption key. It reads the generated Access audience and injects it into a gitignored deployment config; an operator never copies the AUD.

Installation is not complete until authenticated publisher access, a private-site session, an explicit public site, and cookie-free denial for private/restricted content are all verified end to end.
