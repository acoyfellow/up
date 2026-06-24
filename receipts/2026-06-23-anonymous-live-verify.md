# Live receipt: anonymous deploy + claim-URL redaction

Date: 2026-06-23
Branch: feat/anonymous-first

## Watched it run

`UP_RUN_LIVE_ANONYMOUS=yes UP_ACCEPT_CLOUDFLARE_TERMS=yes bun run verify:anonymous`

- Deployed `examples/binding-lab` to a real Temporary Account (`puzzling-hellebore.workers.dev`)
  with no Cloudflare account and no inherited credentials.
- Wrangler auto-provisioned KV + D1 and bound the Durable Object and Static Assets.
- Public URL exercised live:
  - page serves (Static Assets) — HTTP 200
  - KV read/write — pageViews 1 → 2 across requests
  - Durable Object — roomVisits 1
  - D1 — notes table created, written row persisted
- Left to expire (~60 min). Never claimed.

This is the "watched it run" receipt behind the homepage headline.

## Security fix (regression)

`deployAnonymous` and `claim` previously printed the account-wide claim URL to
stdout. Fixed:

- deploy never prints the claim URL; it points to `up claim --open` / `--show`.
- `up claim` withholds the link by default; `--open` opens it without printing;
  `--show` is the explicit interactive reveal.
- Wrangler's own claim line was already redacted by the output relay.
- The link is stored locally in `wrangler-temporary-account.toml` (mode 600).

CLI tests updated to assert the link is withheld from deploy/`claim` and only
revealed via `--show`. 9/9 CLI tests pass.
