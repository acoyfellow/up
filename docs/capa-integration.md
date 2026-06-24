# Capa integration contract

Status: **same-account runtime proof passed; user-facing installer not implemented.**

## Product composition

Up owns the temporary application graph:

- Temporary Account lifecycle;
- Worker and Static Assets;
- native KV, D1, and Durable Object bindings;
- deployment, verification, expiry, and account claiming.

Capa owns generated third-party API capabilities:

- OpenAPI-derived methods;
- one capability Worker per provider;
- JSRPC service binding entrypoint;
- provider credential isolation;
- `{ result, evidence }` call contract.

The two projects remain independently useful.

## Same-account requirement

Cloudflare service bindings do not cross account boundaries. An anonymous Up app cannot bind to an existing permanent `capa-stripe` Worker.

Up must install the selected Capa capability Worker into the same Temporary Account:

```text
Temporary Account
├── app Worker
├── native bindings
├── capa-github Worker
├── GITHUB_API_KEY secret on capa-github
└── app.GITHUB → capa-github.GithubCapability
```

Claiming then covers the app, capability Worker, secret, native resources, and data together.

## Proven flow

The 2026-06-23 spike proved:

1. deploy a generated Capa Worker with `wrangler deploy --temporary`;
2. store a short-lived credential with `wrangler secret put --temporary`;
3. deploy a caller Worker in the reused account;
4. bind it to the generated Worker entrypoint;
5. execute a real read-only method;
6. receive credential-free result and evidence;
7. redeploy and preserve the service binding;
8. inventory both Workers, secret, and binding in one claimable account.

It also proved Capa `main` Stripe reaches the upstream API and returns a bounded credential-free failure receipt for a fake token.

See [`receipts/2026-06-23-capa-temporary-account-spike.md`](../receipts/2026-06-23-capa-temporary-account-spike.md).

## Required Capa install artifact

Before Up exposes a Connect button, Capa needs an immutable install artifact for each capability:

```ts
interface CapaInstallArtifact {
  schemaVersion: 1;
  name: string;
  revision: string;
  entrypoint: string;
  requiredSecrets: Array<{
    name: string;
    label: string;
    auth: 'bearer' | 'private-token' | 'basic';
  }>;
  operations: number;
  namespaces: number;
  bundleUrl: string;
  bundleSha256: string;
}
```

Up should download and verify one bundle. It should not clone the whole Capa repository, depend on the operator's local checkout, or generate a large provider from OpenAPI during every deploy.

The first supported revision should pin Capa `main` at `382359f` or a newer revision with equal smoke evidence. The local `rewrite/distilled-runtime` branch at `cfe48ab` is not installable yet because its lazy provider operation is absent from the deployed Worker bundle.

## Local composer UX

The product UI should run on localhost:

```sh
up open ./app
```

Source, Temporary Account state, provider credentials, and claim URLs remain local.

### Stack screen

```text
Runtime
✓ Worker                         _worker.js
✓ Static Assets                  4 files

Cloudflare native
✓ KV                             CACHE
✓ D1                             DB
✓ Durable Object                 ROOMS → Room
[ + Add native binding ]

API capabilities by Capa
✓ GitHub                         GITHUB
[ + Connect another API ]
```

### Native binding click

A click edits the inspectable `up.json` manifest and shows the exact diff before deployment.

### Capa capability click

The dialog shows:

- capability and operation count;
- binding name;
- credential type and masked input;
- external provider dependency;
- Capa source revision and bundle hash;
- explicit statement that the capability Worker and secret install into the Temporary Account;
- explicit statement that the credential never goes to `up.coey.dev` or `capa.coey.dev`.

The provider credential must never enter `up.json`, terminal arguments, evidence, logs, or analytics. The local process pipes it directly to `wrangler secret put --temporary`.

## Deploy confirmation

```text
Deploy this public temporary stack?

• app Worker + browser assets
• KV, D1, Durable Object
• Capa GitHub Worker
• one encrypted provider credential

[ ] Make the app and API public for up to/about 60 minutes
[ ] Accept Cloudflare Terms and Privacy Policy

Deploy stack
```

The post-deploy cockpit lists each real resource and lets the user run a bounded health check. Capa checks expand into the plain JSON evidence receipt.

## Claim confirmation

Before opening Cloudflare, Up lists every app and capability in the session. The UI must state that one claim URL transfers the entire Temporary Account, not the selected app only.

## First product integration

Use GitHub with a narrowly scoped read-only fine-grained token.

The first polished demo should combine:

- Worker and Static Assets;
- KV cache;
- D1 decisions/checklist;
- Durable Object live presence;
- Capa GitHub repository status and evidence.

Do not begin with Stripe. Financial methods and credential risk obscure the platform composition being demonstrated.

## Non-goals

- centralized Up or Capa credential proxy;
- cross-account service binding;
- uploading provider credentials to either public website;
- claiming Capa capabilities transfer without installing their Workers in the Temporary Account;
- presenting all 5,998 operations as reviewed or safe;
- enabling high-risk provider mutations by default.
