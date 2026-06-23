# Reference

## Folder

| File | Contract |
|---|---|
| `index.html` | Required browser entry point |
| `_worker.js` | Optional Worker entry point and Durable Object class exports |
| `up.json` | Optional anonymous binding declaration; requires `_worker.js` |
| other files | Static Assets available through `env.ASSETS` |

## `up.json`

```json
{
  "bindings": {
    "kv": ["CACHE"],
    "d1": ["DB"],
    "durableObjects": [{ "binding": "ROOMS", "className": "Room" }]
  }
}
```

No other root or binding fields are accepted in 0.0.1.

- Binding names: uppercase letter followed by up to 47 uppercase letters, digits, or `_`.
- Binding names must be unique across KV, D1, and Durable Objects.
- Durable Object class names must be valid JavaScript identifiers.
- Up generates one SQLite migration containing the distinct class names.

## Commands

| Command | Contract |
|---|---|
| `up deploy <folder> [name]` | Provision and deploy one public Temporary Account graph |
| `up deploy … --accept-cloudflare-terms` | Explicit non-interactive Terms acceptance |
| `up claim` | Print the current sensitive account claim URL |
| `up claim --open` | Open the dashboard claim flow |
| `up init [directory]` | Install `.up/SKILL.md` and client types |
| `up private <folder> <name>` | Explicit secondary company-mode deployment |

## Anonymous defaults

- public `workers.dev` URL and API;
- up to/about 60 minutes unless claimed;
- 1,000 Static Asset files;
- 5 MiB per Static Asset;
- symbolic links, special files, and sensitive dotfiles rejected;
- stable path-fingerprint Worker name when omitted;
- private staging snapshot removed after deployment;
- no production or CI/CD promise.

## Binding matrix

| Product | Up 0.0.1 |
|---|---|
| Worker runtime | dynamic `_worker.js` |
| Static Assets | `env.ASSETS` |
| KV | draft namespace auto-provisioned by Wrangler |
| D1 | draft database auto-provisioned by Wrangler |
| Durable Objects | generated class binding and SQLite migration |
| Queues | upstream Temporary Account support; not exposed yet |
| Hyperdrive | upstream support; not exposed yet |
| R2, Workers AI, Access | unavailable in current Temporary Account matrix |
| Workflows, Browser Rendering, Containers, Sandboxes, Dispatch | unavailable in current matrix |

## Credential behavior

Up starts Wrangler under `~/.up/anonymous`, sets isolated home/config variables for Windows, macOS, and Linux, and removes current plus deprecated Cloudflare credential variables.

Wrangler can reuse its temporary account cache during the active session. This means one claim URL transfers every deployment and supported resource in that session.

## Secondary company mode

Company mode retains its Access-authenticated router, private R2 deployments, document Durable Object, realtime Durable Object, Workers AI binding, and fixed same-origin client API. Those contracts do not apply to anonymous mode.
