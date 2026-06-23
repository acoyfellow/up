# How-to guides

## Add a Worker to a static folder

Create a root `_worker.js`:

```js
export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return Response.json({ edge: 'ok' });
    return env.ASSETS.fetch(request);
  }
};
```

The rest of the folder remains browser assets.

## Add bindings

Create `up.json`:

```json
{
  "bindings": {
    "kv": ["CACHE"],
    "d1": ["DB"],
    "durableObjects": [{ "binding": "ROOMS", "className": "Room" }]
  }
}
```

Export every Durable Object class from `_worker.js`. Binding names must be unique uppercase identifiers.

## Redeploy an active experiment

```sh
up deploy ./app --accept-cloudflare-terms
```

The default Worker name is a stable fingerprint of the absolute folder path. Pinned Wrangler reuses the active Temporary Account and previously provisioned resources while its credentials and ownership link remain valid.

## Choose a readable Worker name

```sh
up deploy ./app crit-board --accept-cloudflare-terms
```

Explicit names use lowercase letters, numbers, and hyphens. Invalid names fail with a suggested correction rather than being silently rewritten.

## Keep the whole graph

```sh
up claim --open
```

The ownership link grants the whole Temporary Account, including every app, binding, and data record created in the active anonymous Up session. Up stores it locally; do not share or commit it.

After the browser flow, continue from the same source folder:

```sh
bunx wrangler@4.103.0 login
bunx wrangler@4.103.0 whoami
up handoff ./app exact-worker-name --account-id <account-id>
```

See [After you keep an app](after-claim.md) for the copy-ready agent prompt and Access checklist.

## Prepare an agent-authored app

```sh
up init
```

Tell the agent to read `.up/SKILL.md`, build the dynamic app, test locally, and ask before making it public and accepting Cloudflare's Terms. After approval it deploys and exercises every declared binding. If you keep the app, `.up/HANDOFF.md` contains the continuation prompt.

## Use an existing company installation

```sh
up private ./dist team-tool --origin https://up.example.com
```

This is a separate secondary mode. It authenticates through the installation's browser flow and returns a company-private URL.
