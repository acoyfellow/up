# Support

Inhouse is an open-source `0.0.1` product maintained through GitHub.

- Setup or usage question: open a GitHub Discussion.
- Reproducible bug: open an issue with the Inhouse version, browser, Cloudflare resource configuration with identifiers redacted, and the failing step.
- Security concern or possible public exposure: use a private GitHub Security Advisory. Do not post tokens, Access assertions, customer content, account IDs, or private URLs.

Before requesting support, run:

```sh
bun install --frozen-lockfile
bun run check
bun run dry-run
```

For deployment problems, also confirm that Access protects both the control hostname and wildcard site hostname and that `workers.dev` and Preview URLs are disabled.
