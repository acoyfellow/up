# Up

[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Deploy a dynamic Cloudflare app before signup. Keep it if it works.**

Up gives coding agents a Worker, Static Assets, and platform bindings before anyone creates an account, opens OAuth, or copies an API token.

```text
app folder → Worker + assets + bindings → public URL → keep or disappear
```

Up is an independent, user-land experiment. It is not an official Cloudflare product and is not supported by Cloudflare.

## Deploy first

A dynamic Up app is an ordinary folder:

```text
my-app/
├── public/
│   ├── index.html   browser UI
│   └── app.js
├── worker/
│   ├── index.js     dynamic Worker entry point
│   └── helpers.js   normal module imports work
└── up.json          platform bindings
```

Inspect first; this creates no account and makes no remote request:

```sh
bunx github:acoyfellow/up inspect ./my-app
```

Or open the same read-only plan in a friendly localhost UI:

```sh
bunx github:acoyfellow/up open ./my-app
```

The composer uses a random local path, binds only to `127.0.0.1`, and shows exact assets, Worker modules, bindings, exclusions, public/temporary risk, credential isolation, and the deploy command before mutation.

Then deploy:

```sh
bunx github:acoyfellow/up deploy ./my-app
```

```text
Deploying dynamic app with 2 assets without a Cloudflare account
Bindings: CACHE, DB, ROOMS…

Live now

https://up-a1b2c3d4e5.example-account.workers.dev

Expires in about 60 minutes unless claimed.
Public: anyone with this URL can open it.

Keep it: run `up claim ./my-app --open` to open the ownership flow.
Up stores the sensitive link in project-scoped local state and does not print it.
```

No signup, login, permanent token, repository, or Up server is involved. Interactive use asks you to accept Cloudflare’s Terms and Privacy Policy. Agents and other non-interactive sessions must pass the explicit approval flag:

```sh
up deploy ./my-app --accept-cloudflare-terms
```

To keep the account:

```sh
up status ./my-app
up claim ./my-app --open
```

Remove only the local cache and ownership metadata—never remote resources:

```sh
up forget ./my-app
```

If it is not claimed within about 60 minutes, Cloudflare deletes the Temporary Account, Worker, bindings, and data.

## After you keep it

The browser flow gives you ownership of the Temporary Account. The Worker, bindings, and data stay there. Your source code stays in the local folder.

Connect Wrangler with OAuth—no Up API key and no copied Cloudflare API key:

```sh
bunx wrangler@4.103.0 login
bunx wrangler@4.103.0 whoami
```

If `whoami` lists more than one account, choose the account created by the ownership flow and copy its account ID. Then reconnect the exact Worker name shown in the original `workers.dev` URL:

```sh
up handoff ./my-app exact-worker-name \
  --account-id 0123456789abcdef0123456789abcdef
```

Up first confirms that Worker already exists in that account. It then deploys without `--temporary`; Wrangler inherits the existing KV and D1 resources from the Worker's bindings instead of creating replacements.

**Ownership is not authentication.** The app remains public after you keep it. Before adding sensitive data, add [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/) or another login and verify an anonymous request is denied.

Create a scoped Cloudflare API token only when you later add CI/CD. Local development should use `wrangler login`.

### Copy this to your agent

```text
Continue this existing Cloudflare Worker from ./my-app.

1. Ask me to complete `wrangler login` in the browser. Do not ask for or copy an API key.
2. Run `wrangler whoami` and ask me which account was created by the ownership flow if several are listed.
3. Use the exact Worker name from its workers.dev URL.
4. Run `up handoff ./my-app <worker-name> --account-id <account-id>`.
5. Do not create replacement KV or D1 resources. Preserve the existing bindings by name.
6. Test the deployed URL and every binding.
7. Remind me that the URL is public. Ask before adding Cloudflare Access or creating a scoped CI token.
```

See [After you keep an app](docs/how-to/after-claim.md) for the full checklist.

## Bind the platform

`up.json` declares the resources the app expects:

```json
{
  "bindings": {
    "kv": ["CACHE"],
    "d1": ["DB"],
    "durableObjects": [{ "binding": "ROOMS", "className": "Room" }]
  }
}
```

Up turns that into a temporary Wrangler graph. Wrangler auto-provisions KV and D1, deploys Durable Object classes with append-only SQLite migrations, binds Static Assets as `env.ASSETS`, and uploads the Worker and browser files together. Added DO classes append a migration; deletion or rename fails before deployment.

```js
export class Room {
  constructor(state) {
    this.state = state;
  }

  async fetch() {
    const visits = ((await this.state.storage.get('visits')) || 0) + 1;
    await this.state.storage.put('visits', visits);
    return Response.json({ visits });
  }
}

export default {
  async fetch(request, env) {
    const cached = await env.CACHE.get('key');
    const rows = await env.DB.prepare('SELECT * FROM notes').all();
    const room = env.ROOMS.get(env.ROOMS.idFromName('main'));

    if (new URL(request.url).pathname === '/api/state')
      return Response.json({ cached, rows, room: await room.fetch(request).then((r) => r.json()) });

    return env.ASSETS.fetch(request);
  }
};
```

Browser code in `public/` gets a normal same-origin API. Worker modules in `worker/` get real Cloudflare bindings. Legacy root `index.html` + `_worker.js` folders remain accepted as a migration path, but cannot be mixed with the canonical layout. Using the ownership flow keeps the entire Temporary Account and the supported resources created inside it.

## Binding spectrum

| Primitive | Anonymous Up 0.0.1 | Temporary Account contract |
|---|---:|---|
| Worker runtime | **Yes** | Dynamic request handling on `workers.dev` |
| Static Assets | **Yes** | 1,000 files; 5 MiB each |
| KV | **Yes** | Auto-provisioned from `up.json` |
| D1 | **Yes** | One database; 100 MB total |
| Durable Objects | **Yes** | Class binding plus SQLite migration |
| Queues | Supported upstream; Up wiring next | Temporary Accounts allow up to 10 |
| Hyperdrive | Supported upstream; Up wiring next | Two configs; requires an existing database |
| Certificates | Account operation | Supported by Temporary Accounts; configured outside `up.json` |
| R2, Workers AI, Access | **No** | Not in the current Temporary Account matrix |
| Workflows, Browser Rendering, Containers, Sandboxes | **No** | Not in the current matrix |

The boundary is deliberately upstream-shaped. Up does not fake unavailable bindings or proxy them through a permanent service account.

## Third-party APIs through Capa

[Capa](https://capa.coey.dev) turns OpenAPI specs into generated Cloudflare service-binding Workers. Capa `main` at [`382359f`](https://github.com/acoyfellow/capa/commit/382359f) contains 14 API capabilities and 5,998 generated operations—not 5,998 reviewed or equally safe actions—with `{ result, evidence }` returned from every call.

An isolated spike proved the intended composition inside one Temporary Account:

```text
Up app Worker
  └── service binding → Capa capability Worker
                           └── provider credential secret
```

A generated read-only capability returned a real `200`/`pass` evidence receipt, survived caller redeployment, and leaked no credential. Capa `main` Stripe also reached the real upstream API with a deliberately fake token and returned a bounded `401`/`fail` receipt without exposing authorization data.

**The runtime composition is proven; click-to-connect is not shipped yet.** Capa needs immutable per-capability install bundles before Up can safely offer a local connector UI. Existing permanent Capa Workers cannot be bound cross-account; each selected capability Worker must install into the same Temporary Account as the app.

Read the [integration and local composer contract](docs/capa-integration.md) and [spike receipt](receipts/2026-06-23-capa-temporary-account-spike.md).

## Complete dynamic example

[`examples/binding-lab`](examples/binding-lab) is a framework-free dynamic app using:

- a Worker API;
- Static Assets;
- KV for an edge counter;
- D1 for notes;
- a Durable Object for one coordinated room.

Deploy it anonymously:

```sh
up deploy examples/binding-lab binding-lab --accept-cloudflare-terms
```

A real isolated smoke test returned HTTP 200 from both its page and `/api/state`, with live values from all three bindings.

## What Up actually does

Up deliberately stays close to Cloudflare’s bleeding edge instead of recreating its deployment APIs:

1. validates and snapshots the app into a private staging directory;
2. reads a narrow `up.json` binding manifest;
3. generates a temporary Wrangler graph for Worker, assets, KV, D1, and Durable Objects;
4. starts pinned Wrangler in an isolated Up-owned home;
5. removes every current and deprecated Cloudflare credential variable;
6. runs `wrangler deploy --temporary` with experimental resource provisioning;
7. takes the authoritative public URL from Wrangler output;
8. stores the sensitive ownership link locally without printing it.

Wrangler owns proof-of-work, Terms acceptance, short-lived credentials, resource provisioning, upload, account reuse, and dashboard claiming. Up does not reimplement the unpublished provisioning protocol.

The isolated state lives under `~/.up/anonymous` with private permissions. Repeated deploys during one active session reuse the Temporary Account, so **one sensitive ownership link controls every app and binding in that session**.

## The temporary contract

| Contract | Anonymous Up deployment |
|---|---|
| Runtime | Dynamic Worker plus same-origin Static Assets |
| Visibility | Public; URL possession is enough to read it |
| Lifetime | Up to/about 60 minutes unless claimed |
| Credentials | Existing Cloudflare credentials are removed from the child process |
| Name | Stable path fingerprint, or a strictly validated explicit name |
| Ownership | Claim URL grants the whole temporary account; treat it as a secret |
| Production | Not intended for production or CI/CD |

Official primitive: [Claim deployments (Temporary Accounts)](https://developers.cloudflare.com/workers/platform/claim-deployments/).

## Build with an agent

```sh
bunx github:acoyfellow/up init
```

This writes `.up/SKILL.md`. Ask an agent to read it, build the app, deploy it, fetch the real Worker URL, exercise its bindings, revise, and redeploy without stopping for browser authentication.

## Private company mode

The original company-private experiment remains available as a secondary mode:

```sh
up private ./dist team-tool --origin https://up.example.com
```

That path requires a customer-owned Up installation, Cloudflare Access, and browser-mediated CLI authentication. It is retained for comparison and dogfood; it is no longer the default positioning.

## Why this pivot

The old product asked an organization to install infrastructure before anyone could publish. The new product moves the dynamic graph ahead of ownership:

```text
old: install → authenticate → configure bindings → deploy
new: declare bindings → deploy → exercise the real stack → decide whether to own it
```

The point is not anonymous static hosting. The point is letting an agent discover how far a real Cloudflare application can get before signup becomes necessary.

## Repository map

```text
cli/up.ts                         staging, binding graph, anonymous deploy/claim
examples/binding-lab/            Worker + Assets + KV + D1 + Durable Object proof
tests/anonymous-cli.test.ts      subprocess, binding config, isolation, claim proof
skills/up/SKILL.md                agent dynamic-app contract
docs/anonymous-first-brief.md    product and security boundary
docs/capa-integration.md         proven composition and local composer contract
src/                              retained company-mode runtime
```

## Verify

```sh
bun install
bun run check
bun run test:e2e
```

Ordinary tests never create anonymous accounts. The CLI suite uses a real subprocess and fake Wrangler executable to verify staging, generated binding configuration, argument boundaries, credential removal, claim redaction, and public URL handling. Live Temporary Account tests are deliberate manual checks because they create rate-limited remote resources.

## Documentation

- [Anonymous-first source brief](docs/anonymous-first-brief.md)
- [Security](SECURITY.md)
- [Capa integration contract](docs/capa-integration.md)
- [Historical company-private source brief](docs/0.0.1-source-brief.md)
- [Binding Lab](examples/binding-lab)

## License

MIT © Jordan Coeyman
