# Support

Up is an independent open-source `0.0.1` experiment maintained through GitHub. It is not an official Cloudflare product and is not supported by Cloudflare.

- Usage question: open a GitHub Discussion.
- Reproducible bug: open an issue with the Up and Wrangler versions, operating system, redacted `up.json`, and failing step.
- Security concern, leaked claim URL, or unexpected account mutation: use a private GitHub Security Advisory.

Never post:

- Temporary Account API tokens;
- claim URLs or claim tokens;
- permanent Cloudflare tokens;
- deployed private/customer data;
- account IDs unless needed and explicitly redacted.

Before requesting support, run:

```sh
bun install --frozen-lockfile
bun run check
bun run test:e2e
```

## Anonymous dynamic mode

Confirm:

- the app has `index.html`;
- dynamic apps have a root `_worker.js`;
- `up.json` declares only KV, D1, or Durable Object bindings;
- non-interactive runs pass `--accept-cloudflare-terms` only after human approval;
- no inherited credential entered the isolated Wrangler child;
- the app is expected to be public and temporary.

## Secondary company mode

Company-mode issues are separate. Confirm Access protects the control and wildcard hostnames and that `workers.dev`, preview URLs, and public R2 remain disabled for that installation.
