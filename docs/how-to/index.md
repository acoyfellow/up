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

The default Worker name is a stable fingerprint of the absolute folder path. Pinned Wrangler reuses the active Temporary Account and previously provisioned resources while its credentials and claim link remain valid.

## Choose a readable Worker name

```sh
up deploy ./app crit-board --accept-cloudflare-terms
```

Explicit names use lowercase letters, numbers, and hyphens. Invalid names fail with a suggested correction rather than being silently rewritten.

## Claim the whole graph

```sh
up claim --open
```

The claim link grants the whole Temporary Account, including every app, binding, and data record created in the active anonymous Up session. Do not share or commit it.

## Prepare an agent-authored app

```sh
up init
```

Tell the agent to read `.up/SKILL.md`, build the dynamic app, test locally, and ask before making it public and accepting Cloudflare's Terms. After approval it deploys and exercises every declared binding.

## Use an existing company installation

```sh
up private ./dist team-tool --origin https://up.example.com
```

This is a separate secondary mode. It authenticates through the installation's browser flow and returns a company-private URL.
