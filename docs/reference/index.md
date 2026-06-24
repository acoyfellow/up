# Reference

## Folder

Canonical layout:

| Path | Contract |
|---|---|
| `public/index.html` | Required browser entry point |
| `public/**` | Static Assets available through `env.ASSETS` |
| `worker/index.js` | Optional module Worker entry point and Durable Object exports |
| `worker/**` | Worker module graph preserved for Wrangler bundling |
| `up.json` | Optional anonymous binding declaration; requires a Worker |

Legacy root `index.html` + `_worker.js` folders remain accepted as a migration path. Do not mix canonical and legacy layouts. Up rejects symbolic links, sensitive dotfiles, and special files in both asset and Worker trees.

## `up.json`

```json
{
  "bindings": {
    "kv": ["CACHE"],
    "d1": ["DB"],
    "durableObjects": [{ "binding": "ROOMS", "className": "Room" }]
  },
  "checks": [
    {
      "name": "Binding state",
      "path": "/api/state",
      "status": 200,
      "jsonKeys": ["pageViews", "roomVisits", "notes"],
      "bindings": ["CACHE", "DB", "ROOMS"]
    }
  ]
}
```

No other root or binding fields are accepted in 0.0.1. `checks` allows up to 20 bounded same-origin GET checks. Each check declares an expected HTTP status, optional top-level JSON keys, and the binding names exercised by that app route. Up never follows a check to another origin.

- Binding names: uppercase letter followed by up to 47 uppercase letters, digits, or `_`.
- Binding names must be unique across KV, D1, and Durable Objects.
- Durable Object class names must be valid JavaScript identifiers.
- Up stores append-only SQLite migration history per active project session. Initial classes use `v1`; added classes append `v2`, `v3`, and so on.
- Class deletion or rename fails before Wrangler. Start a fresh Temporary Account explicitly with `up forget <folder>` when destructive migration semantics are intended.

## Commands

| Command | Contract |
|---|---|
| `up inspect <folder> [name]` | Local staging preflight; lists exact assets, modules, bindings, exclusions, and command plan |
| `up open <folder> [name]` | Open the plan at a random path on a `127.0.0.1`-only server; explicit consent starts the pinned CLI with redacted progress, health evidence, expiry/retry state, ownership, and handoff controls |
| `up deploy <folder> [name]` | Provision and deploy one public Temporary Account graph |
| `up status [folder]` | Show project-scoped URL, expiry, and bindings without ownership authority |
| `up deploy … --accept-cloudflare-terms` | Explicit non-interactive Terms acceptance |
| `up claim` | Show ownership timing without printing the ownership link |
| `up claim --open` | Open the ownership flow without printing the link |
| `up claim --show` | Explicitly reveal the sensitive ownership link |
| `up forget [folder]` | Remove only that project's local Up/Wrangler cache; never remote resources |
| `up handoff <folder> <name> --account-id <id>` | Continue an existing claimed Worker through normal Wrangler OAuth |
| `up init [directory]` | Install `.up/SKILL.md`, `.up/HANDOFF.md`, and client types |
| `up private <folder> <name>` | Legacy company-mode deployment; scheduled for removal |

## Anonymous defaults

- public `workers.dev` URL and API;
- about 60 minutes unless kept;
- 1,000 Static Asset files;
- 5 MiB per staged file;
- symbolic links, special files, and sensitive dotfiles rejected;
- stable path-fingerprint Worker name when omitted;
- each absolute project path receives an isolated Wrangler home/cache;
- no-folder session commands resolve to the most recently deployed project;
- private staging snapshot removed after deployment;
- generated Wrangler config for static and dynamic projects;
- no production or CI/CD promise.

## Binding matrix

| Product | Up 0.0.1 |
|---|---|
| Worker runtime | `worker/index.js` module graph (legacy `_worker.js` accepted) |
| Static Assets | `public/**` through `env.ASSETS` |
| KV | draft namespace auto-provisioned by Wrangler |
| D1 | draft database auto-provisioned by Wrangler |
| Durable Objects | class bindings with append-only SQLite migration history; add-class redeploys supported |
| Queues | supported by Temporary Accounts; Up wiring not shipped yet |
| Hyperdrive | supported by Temporary Accounts; Up wiring not shipped yet; requires an existing database |
| Certificates | supported account operation; configured outside `up.json` |
| R2, Workers AI, Access | unavailable in current Temporary Account matrix |
| Workflows, Browser Rendering, Containers, Sandboxes, Dispatch | unavailable in current matrix |

## Connected services with Capa

Capa currently contains 14 generated bindings: Box, Discord, GitHub, GitLab, Jira, Kubernetes, Sentry, Slack, Stripe, Twilio, Twilio Messaging, Twilio Verify, Twitch, and Zoom.

A manual same-account research spike passed: app Worker → private Capa Worker → upstream API. Up does not install or configure Capa bindings yet. The user-facing installer depends on immutable, hash-verified Capa bundles.

See the [Capa integration contract](../capa-integration.md) and [live spike receipt](../../receipts/2026-06-23-capa-temporary-account-spike.md).

## After ownership

Run `wrangler login`, select the new account from `wrangler whoami`, then run `up handoff` with the exact Worker name and account ID. Handoff first proves that the Worker exists in that account. It deploys without `--temporary` and lets Wrangler inherit existing KV and D1 bindings from the Worker's settings.

No Up API key is involved. A scoped Cloudflare API token is only needed later for CI/CD. Ownership does not make the public URL private; add Access or application authentication separately.

## Credential behavior

Up starts anonymous Wrangler under `~/.up/anonymous`, sets isolated home/config variables for Windows, macOS, and Linux, and removes current plus deprecated Cloudflare credential variables.

Wrangler can reuse its temporary account cache during the active session. This means one ownership link controls every deployment and supported resource in that session.
