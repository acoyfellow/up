# Tutorial: deploy a dynamic stack before signup

## 1. Make one app folder

```text
app/
├── index.html
├── app.js
├── _worker.js
└── up.json
```

`_worker.js` handles dynamic routes and serves browser files through `env.ASSETS`:

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
    if (new URL(request.url).pathname === '/api/value') {
      await env.CACHE.put('last', new Date().toISOString());
      const rows = await env.DB.prepare('SELECT 1 AS ok').all();
      const room = env.ROOMS.get(env.ROOMS.idFromName('main'));
      return Response.json({ rows, room: await room.fetch(request).then((r) => r.json()) });
    }
    return env.ASSETS.fetch(request);
  }
};
```

## 2. Declare bindings

```json
{
  "bindings": {
    "kv": ["CACHE"],
    "d1": ["DB"],
    "durableObjects": [{ "binding": "ROOMS", "className": "Room" }]
  }
}
```

Up supports only this narrow manifest in anonymous mode. Unknown fields fail rather than passing arbitrary account configuration through to Wrangler.

## 3. Deploy

Interactive terminal:

```sh
bunx github:acoyfellow/up deploy ./app
```

Agent/background session, after the user approves Cloudflare's Terms and Privacy Policy:

```sh
up deploy ./app --accept-cloudflare-terms
```

Up snapshots the folder, isolates credentials, generates a temporary Wrangler configuration, and lets Wrangler provision the supported resources and deployment.

## 4. Exercise the stack

Open the page and fetch `/api/value`. Verify KV, D1, and Durable Object behavior. Revise and redeploy during the active session.

## 5. Decide

Keep the Worker, resources, and data:

```sh
up claim --open
```

Or do nothing. Cloudflare deletes the unclaimed Temporary Account and whole dynamic graph after up to/about 60 minutes.
