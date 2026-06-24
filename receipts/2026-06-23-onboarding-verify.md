# Access-first onboarding: end-to-end verification

Date: 2026-06-23
Branch: feat/anonymous-first

## Onboarding flow under verification

Employee → live private app, no pre-existing per-app setup:

1. `up private ./dist <name>`
2. CLI opens `/app/cli-auth`; employee authenticates through Cloudflare Access.
3. PKCE code → `POST /cli/exchange` → short-lived deploy-only token.
4. `POST /cli/sites/<name>/deployments` (manifest).
5. `PUT /cli/deployments/<id>/assets` per file (sha256 + size enforced).
6. `POST /cli/deployments/<id>/activate` (atomic; rejects partial/mismatched).
7. `<name>.<domain>` serves only to authenticated org members; anonymous → Access login.

This dogfoods temporary accounts (the public deploy primitive) plus the OAuth/Access
login as the claim/identity layer.

## Single command

```sh
bun run company:verify:onboarding         # local + gated production
bun run company:verify:onboarding:local   # local only (fast inner loop)
```

Orchestrator: `scripts/onboarding-verify.mjs`. Exit codes: `0` ok · `1` failure ·
`78` blocked (needs human-authorized input, not a failure).

## Local — GREEN

- `local: onboarding flow tests` — 17 passed, real Durable Objects + R2 via the
  workers pool: create → upload (digest/size) → activate (atomic) → private serve →
  identity → per-site capability isolation → atomic supersede.
- `local: build` — SvelteKit + Worker build.
- `local: live fail-closed boot` — boots `wrangler.local.jsonc` and asserts the
  deployed Worker gates correctly with Access unconfigured and no bypass:
  - `/api/health` → `accessConfigured:false`;
  - `/api/sites` → 503/403;
  - `/cli/sites/<x>/deployments` (no token) → 401/503;
  - unknown `<x>.localhost` private site → 404/302 (raw Host header).

## Production — BLOCKED (by design, requires the human)

The unattended path can never mutate AX production. The live authed deploy runs only
with BOTH a human-minted token and explicit approval:

- `production: Access posture guard` — needs `UP_ACCESS_APPLICATION_FILE` (+ expected
  app/IdP/domain/host env) → read-only employee-only-policy check.
- `production: live authed deploy` — needs `CF_ACCESS_TOKEN`
  (`cloudflared access token -app https://up.ax.cloudflare.dev`) AND
  `UP_ALLOW_PRODUCTION_DEPLOY=yes`. Runs `scripts/production-e2e.mjs`:
  authed deploy → serve "Private by default." → `/__up/me` identity →
  anonymous request blocked.

## To finish production verification (human step)

```sh
export CF_ACCESS_TOKEN="$(cloudflared access token -app https://up.ax.cloudflare.dev)"
export UP_ALLOW_PRODUCTION_DEPLOY=yes
# optional posture guard inputs:
#   UP_ACCESS_APPLICATION_FILE, UP_EXPECTED_ACCESS_APP_ID, UP_EXPECTED_ACCESS_IDP,
#   UP_EXPECTED_EMAIL_DOMAIN, UP_CONTROL_HOST
bun run company:verify:onboarding
```
