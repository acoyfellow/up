# Up anonymous-first dynamic source brief

## Product sentence

Up deploys a dynamic Cloudflare app—Worker code, Static Assets, and supported bindings—before the deployer has a Cloudflare account, then gives the human about one hour to claim the whole stack.

## Mechanism

```text
index.html + _worker.js + up.json
  ↓ validate and snapshot
pinned Wrangler in isolated state
  ↓ proof of work + experimental resource provisioning
Cloudflare Temporary Account
  ├── Worker runtime
  ├── Static Assets
  ├── KV
  ├── D1
  └── Durable Objects
  ↓
public workers.dev URL + sensitive account claim URL
  ↓
claim every resource, or expire together
```

Up wraps the supported `wrangler deploy --temporary` interface. It does not call the unpublished `/provisioning/previews` API directly.

## Utility

Agents need to exercise actual platform behavior—not just render static output—inside a write → deploy → fetch → revise loop. A temporary full-stack graph is enough to validate the architecture. Ownership is deferred until the dynamic app earns it.

## Folder contract

```text
app/
├── index.html
├── browser files…
├── _worker.js       optional; makes the app dynamic
└── up.json          optional; requires _worker.js
```

`up.json` version 0.0.1:

```json
{
  "bindings": {
    "kv": ["CACHE"],
    "d1": ["DB"],
    "durableObjects": [{ "binding": "ROOMS", "className": "Room" }]
  }
}
```

Unknown fields fail closed. Binding names are unique uppercase identifiers. Durable Object classes are exported by `_worker.js` and receive one generated SQLite migration.

Worker code uses `env.ASSETS.fetch(request)` for browser assets and normal binding APIs for dynamic routes.

## Default commands

```sh
up deploy <folder> [name]
up deploy <folder> [name] --accept-cloudflare-terms  # agents/non-interactive
up claim [--open|--show]
up handoff <folder> <exact-worker-name> --account-id <claimed-account-id>
```

- The deployment is public.
- Existing and deprecated Cloudflare credentials are removed.
- Up state is isolated under `~/.up/anonymous` across supported home/config variables.
- An omitted Worker name is a stable fingerprint of the local path, not the folder name.
- Explicit invalid names are rejected rather than silently rewritten.
- The app is copied through no-follow file handles into a private staging snapshot.
- Wrangler output is filtered so its ownership link is withheld; Up stores it locally and reveals it only with explicit `up claim --show`.
- Up consumes the authoritative `workers.dev` target from Wrangler output.
- The Temporary Account expires after up to/about 60 minutes unless claimed.
- The ownership URL grants ownership of every app and resource in the active anonymous session.
- After ownership, `up handoff` verifies the existing Worker in the selected account and continues through normal Wrangler OAuth without auto-creating replacement resources.

## After ownership

The human completes the browser flow, runs `wrangler login`, and selects the new account from `wrangler whoami`. `up handoff` requires that account ID and the exact Worker name. It fails before deployment if the Worker does not already exist there.

Wrangler inherits existing KV and D1 bindings from the Worker's settings by binding name. No Up API key is involved. The URL remains public until the owner adds Cloudflare Access or application authentication. Scoped API tokens are a later CI/CD choice, not part of onboarding.

## Binding surface

| Primitive | Up status | Boundary |
|---|---|---|
| Worker | implemented | root `_worker.js` |
| Static Assets | implemented | `env.ASSETS`; 1,000 files, 5 MiB each |
| KV | implemented | draft namespace auto-provisioned by Wrangler |
| D1 | implemented | one draft database; current Temporary Account total 100 MB |
| Durable Objects | implemented | named class binding and SQLite migration |
| Queues | supported upstream; Up wiring next | requires explicit queue lifecycle orchestration |
| Hyperdrive | supported upstream; Up wiring next | needs an existing external database and connection policy |
| Certificates | supported account operation | ownership/account operation, not app-local API |
| R2, Workers AI, Access | excluded | absent from current Temporary Account matrix |
| Workflows, Browser Rendering, Containers, Sandboxes, Dispatch | excluded | absent from current matrix |

Up does not interpret general Wrangler configuration. The narrow manifest prevents a temporary deployment from quietly requesting permanent-account-only resources or arbitrary account mutations.

## Security boundary

The public URL grants read and API access. Dynamic Worker code is user-authored and can spend the Temporary Account’s bounded resources. A hard-to-guess hostname is not privacy.

The claim URL grants ownership of the entire account and is more sensitive than the public URL. Wrangler stores a short-lived API token and claim metadata in a mode-600 file inside Up's mode-700 state directory. Up never prints the temporary API token.

The agent must receive human approval before passing `--accept-cloudflare-terms`. This explicitly confirms Cloudflare’s Terms and Privacy Policy in non-interactive mode.

Cloudflare applies proof-of-work, rate limits, and additional abuse controls. Up must not market this path for production or CI/CD.

## Secondary mode

The original company-private implementation remains behind:

```sh
up private <folder> <name> --origin <installation>
```

It is not the default product. Its Access, R2, Workers AI, Durable Object capabilities, and customer-owned installation graph are retained for comparison while the dynamic anonymous direction is evaluated.

## Proof app

`examples/binding-lab` must remain framework-free and demonstrate:

- browser assets served by `env.ASSETS`;
- a Worker API route;
- KV mutation;
- D1 schema creation/read/write;
- Durable Object state.

A live isolated smoke must return HTTP 200 from the page and `/api/state` before binding support is claimed.

## Review gate

- a clean machine deploys Worker code and assets without Cloudflare credentials;
- KV, D1, and Durable Object bindings are generated from one inspectable manifest;
- inherited current/deprecated credentials cannot reach Wrangler;
- non-interactive use fails without explicit Terms acceptance;
- the authoritative URL comes from Wrangler;
- the claim URL appears exactly once and never in stderr/debug output;
- expiry and account-wide claim semantics are explicit;
- file staging rejects symlinks, secret dotfiles, unsupported file types, and mutation during read;
- ordinary CI creates no remote account;
- company mode cannot be entered accidentally.

## Sources

- <https://developers.cloudflare.com/workers/platform/claim-deployments/>
- <https://developers.cloudflare.com/changelog/post/2026-06-19-temporary-accounts-for-agents/>
- <https://blog.cloudflare.com/temporary-accounts/>
- <https://github.com/cloudflare/workers-sdk>
