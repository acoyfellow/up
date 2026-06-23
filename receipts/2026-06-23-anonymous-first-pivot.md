# Anonymous-first pivot receipt — 2026-06-23

## Decision

Up's default product is now:

```text
Worker + Assets + bindings → public Temporary Account graph → claim or expire
```

The front-and-center utility is dynamic: `_worker.js` plus Static Assets, KV, D1, and Durable Objects deploy and transfer together. Static-only folders remain a subset.

The company-private Access installation remains a secondary `up private` mode. No AX production Worker, route, Access policy, DNS record, or permanent Cloudflare account was changed by this pivot branch.

## Sources reviewed

- Cloudflare claim-deployments documentation
- June 19 Temporary Accounts changelog
- Temporary Accounts launch post
- installed Wrangler `4.103.0` source and tests
- current Workers SDK implementation of proof of work, temporary account storage, credential rejection, and claim output
- internal documentation MCP was attempted; the `cf-portal` gateway returned HTTP 500 and was unavailable during this review

## Current official matrix

Temporary Accounts currently document support for:

- Workers and `workers.dev` deployments;
- Static Assets: 1,000 files, 5 MiB each;
- KV;
- one D1 database, 100 MB total;
- Durable Objects for commands accepting temporary credentials;
- two Hyperdrive configurations and 10 connections;
- 10 Queues;
- certificate commands using temporary credentials.

R2, Workers AI, Access, custom domains, wildcard routes, Workflows, Browser Rendering, Containers, Sandboxes, Workers Builds, and Dispatch Namespaces are not listed for temporary use.

## Implementation boundary

Up invokes pinned Wrangler rather than copying the unpublished `/client/v4/provisioning/previews` protocol. Wrangler owns:

- Terms acceptance;
- proof of work;
- temporary API-token creation;
- account caching;
- upload and deployment;
- claim URL generation.

Up owns:

- static-folder validation;
- local credential isolation;
- stable non-identifying Worker naming;
- public/expiry/claim warnings;
- secondary company-mode dispatch.

## Live anonymous smoke

Two real isolated Temporary Accounts were created without OAuth or permanent Cloudflare credentials.

1. A one-file static site deployed and returned HTTP 200.
2. `examples/binding-lab` deployed a Worker, Static Assets, KV, D1, and a SQLite Durable Object through the generated anonymous graph. The page and `/api/state` both returned HTTP 200. The API returned live values from KV and the Durable Object plus a successful D1 query result.

Up withheld Wrangler's raw claim URL and printed one labeled sensitive ownership link. Claim URLs and temporary credentials stayed out of git and this receipt, then were deleted from local disk. The unclaimed smoke accounts expire automatically after up to/about 60 minutes.

## Security decision

The former blanket prohibition on public `workers.dev` uploaded content applied to company-private Up. The user explicitly approved an anonymous-first pivot on 2026-06-23. Public `workers.dev` is now expected only for the default disposable mode and must be labeled public.

The company-mode prohibition remains unchanged: never expose its R2 content or private sites through `workers.dev` or preview URLs.
