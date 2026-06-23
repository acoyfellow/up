# Agent guide

Up is an independent anonymous-first publishing experiment on Cloudflare.

## Commands

```sh
bun run check
bun run test:e2e
bun cli/up.ts deploy <folder> [name]
```

## Default anonymous mode

- `up deploy` intentionally creates a public `workers.dev` deployment in a Cloudflare Temporary Account.
- Treat `_worker.js` as executable server code and review the `up.json` binding graph before deploying.
- Confirm the folder contains no credentials, private data, or internal-only content.
- Expose only Worker, Static Assets, KV, D1, and Durable Objects until another Temporary Account binding has real smoke evidence.
- Require explicit human approval before an agent passes `--accept-cloudflare-terms`.
- Label the returned URL/API public and the account-wide claim URL sensitive.
- Never commit, screenshot, log, or forward the claim URL or temporary API token.
- Use pinned Wrangler's documented `--temporary` interface; do not reimplement the unpublished provisioning endpoint.
- Keep ordinary CI offline. A live anonymous smoke test is a deliberate remote mutation and must use isolated state.
- Remove inherited Cloudflare credentials and isolate Wrangler state so anonymous mode cannot touch a permanent account.
- Do not promise more than the documented 60-minute unclaimed lifetime.
- Do not position Up as an official or supported Cloudflare product.

## Secondary company mode

The retained `up private` path has a separate trust boundary:

- Never bypass Cloudflare Access locally or in production.
- Never expose company-mode uploaded content on `workers.dev`, Preview URLs, or public R2.
- Never execute uploaded code on the control-plane origin.
- Every binding read requires verified identity; every mutation also requires authorization and same-origin checks.
- Keep deployment objects immutable and activation atomic.
- Do not deploy placeholder Access configuration.
- Never deploy or modify the AX production Worker, routes, DNS, R2, or Access without explicit user approval.
