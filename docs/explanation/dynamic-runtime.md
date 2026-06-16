# Dynamic runtime

Up remains static by default. A deployment that includes a root `_worker.js` file opts into an isolated Dynamic Worker for requests under `/api/*`.

## Trust boundary

The control Worker never evaluates uploaded code. It loads the active deployment's `_worker.js` through Cloudflare's Worker Loader binding, producing a separate Dynamic Worker isolate keyed by deployment ID and code digest.

The initial runtime profile is intentionally narrow:

- outbound network access is blocked (`globalOutbound: null`)
- no environment variables or control-plane bindings are passed
- CPU is limited to 50 ms per invocation
- subrequests are limited to 5
- code is limited to 1 MiB
- dynamic responses cannot set cookies
- errors return a generic `502` without source, stack, or logs
- static paths continue to use the verified R2 deployment

This is the base on which Up adds scoped secret operations, an isolated SQLite facet, and durable scheduled workflows. Those capabilities are passed as explicit narrow bindings; the dynamic Worker never receives Up's registry, R2 bucket, Access keys, or deployment authority.
