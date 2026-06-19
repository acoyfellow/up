# Up

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/acoyfellow/up)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Publish a folder to a company-private URL.**

An organization installs Up once in its Cloudflare account. Employees and coding agents can then publish small internal apps without creating a repository, deployment pipeline, database, credentials, or authentication flow for each app.

```text
folder + name → verified upload → atomic activation → company-private URL
```

Dogfood: <https://up.ax.cloudflare.dev> · Version: `0.0.1`

## Publish

Browser:

```text
Open Up → choose folder → choose name → publish
```

CLI:

```sh
bunx github:acoyfellow/up init
bunx github:acoyfellow/up deploy ./dist lunch-vote
```

```text
Authenticated · 3 files ready
Uploading 3/3 style.css
Published

https://lunch-vote.up.example.com
Access: your organization
```

Both clients use the same manifest, upload, and activation API. A copied URL does not grant access; Up verifies a company session before returning content.

## Fixed browser API

Every site can import one same-origin module:

```js
import { up } from '/_up/client.js';

const viewer = await up.identity.current();

const votes = up.db.collection('votes');
await votes.create({ choice: 'Tacos', voter: viewer.email });

await up.files.put('menu.txt', new Blob(['Tacos · Pizza · Salad']));

const result = await up.ai.chat([
  { role: 'user', content: 'Summarize today’s vote' }
]);

const room = up.realtime.channel('votes');
room.on('vote', renderVote);
room.send('vote', { choice: 'Tacos' });
```

Browser code receives no Cloudflare credentials or resource identifiers.

| API | Cloudflare mechanism |
|---|---|
| `up.identity` | Access-backed Up session |
| `up.db` | site-named SQLite Durable Object |
| `up.files` | site-prefixed private R2 objects |
| `up.ai` | Workers AI with a fixed model and limits |
| `up.realtime` | site-and-channel Durable Object WebSockets |

## Complete example

[`examples/lunch-vote`](examples/lunch-vote) is plain HTML, CSS, and JavaScript. Two authenticated browsers can vote, see realtime updates, upload a menu, and ask Workers AI for a summary. It has no `_worker.js`, credentials, framework, or infrastructure configuration.

Demo video: [watch the 0.0.1 capability proof](demo/up-0.0.1.mp4)

## Install for a company

Up uses Cloudflare OAuth. The current operator path is:

```sh
export UP_OAUTH_CLIENT_ID=<client-id>
bun run oauth:connect

export CLOUDFLARE_ACCOUNT_ID=<account-id>
export UP_CONTROL_HOST=up.example.com
export UP_PARENT_ZONE=example.com
export UP_ALLOWED_DOMAIN=example.com
bun run setup
```

The installer creates customer-owned resources:

```text
Cloudflare Access
       ↓
Up Worker + SvelteKit assets
  ├── private R2
  ├── Registry Durable Object
  ├── Database Durable Object namespace
  ├── Realtime Durable Object namespace
  └── Workers AI
```

The Worker, Access application, DNS, R2, and Durable Objects remain visible in the customer account. `workers.dev` and preview URLs stay disabled.

Alchemy v2 was tested and omitted from this revision because it cannot yet express Workers AI and Access without custom provider code. See [`receipts/2026-06-19-alchemy-v2-decision.md`](receipts/2026-06-19-alchemy-v2-decision.md).

## Trust boundary

- Every new site is company-private.
- The site hostname selects scope only after Up verifies identity.
- Site A cannot address Site B’s database, files, or realtime room.
- Browser code never receives AI or storage credentials.
- Deployment files stay pending until every path, size, and SHA-256 digest passes verification.
- Activation changes one pointer, so visitors receive a complete old or complete new deployment.
- Anonymous probes receive Access before uploaded bytes.

Read [SECURITY.md](SECURITY.md) for the exact contracts.

## Repository map

```text
src/core-backend.ts       deploy protocol and site request routing
src/capabilities.ts       fixed browser API and site scoping
src/site-database.ts      document collections
src/site-realtime.ts      authenticated channel WebSockets
src/auth.ts               Access JWT verification
cli/up.ts                 init and deploy
skills/up/                agent instructions and client types
examples/lunch-vote/      complete framework-free proof
tests/up.test.ts          runtime, capability, and isolation proof
wrangler.jsonc            installation graph
```

The source contract is captured in [`docs/0.0.1-source-brief.md`](docs/0.0.1-source-brief.md).

## Verify

```sh
bun install
bun run check
bun run test:e2e
```

The suite uses the real Workers runtime, SQLite Durable Objects, R2, WebSockets, SvelteKit SSR, and Access/session logic. It does not use application mocks.

## Documentation

- [Tutorial](docs/tutorial/index.md)
- [How-to guides](docs/how-to/index.md)
- [Reference](docs/reference/index.md)
- [Explanation](docs/explanation/index.md)

## License

MIT © Jordan Coeyman
