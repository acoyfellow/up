# Agent guide

Up is a security-first static publishing plane on Cloudflare.

## Commands

```sh
bun run build
bun run typecheck
bun run test
bun run dry-run
```

## Non-negotiables

- Never bypass Cloudflare Access locally or in production.
- Never expose uploaded content on `workers.dev`, Preview URLs, or public R2.
- Never execute uploaded code on the control-plane origin.
- Every binding read requires verified identity; every mutation also requires ownership and same-origin checks.
- Keep deployment objects immutable and activation atomic.
- Do not deploy placeholder Access configuration.
