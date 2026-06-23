# Contributing

Use Bun and Node 22 or newer.

```sh
bun install
bun run check
bun run test:e2e
```

Keep the product at version `0.0.1` and preserve these boundaries.

## Anonymous dynamic mode

- Worker code, Static Assets, KV, D1, and Durable Objects are the current public contract.
- Add a live binding claim only after an isolated Temporary Account smoke proves it.
- Do not add unsupported bindings or silently proxy permanent-account resources.
- Keep claim URLs and temporary tokens out of logs, tests, fixtures, screenshots, and git.
- Keep normal CI offline; live smoke tests are deliberate rate-limited mutations.
- Preserve explicit Terms acceptance for non-interactive deployments.
- Preserve credential and filesystem isolation.

## Secondary company mode

- Preserve fail-closed Access behavior.
- Do not add public R2, `workers.dev`, preview URLs, or local authentication bypasses.
- Add runtime tests for authorization and storage changes.
- Never run company production scripts while reviewing anonymous-mode changes.

Open focused pull requests. Explain the authority boundary when changing deployment, bindings, public routes, expiration, claim behavior, or credential handling.
