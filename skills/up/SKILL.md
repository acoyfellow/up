# Up

Use Up when the user wants an agent to publish and exercise a small dynamic Cloudflare app immediately, before creating or authenticating an account.

## Dynamic app contract

Build framework-free output unless the project already has a build system:

```text
dist/
├── index.html
├── app.js
├── _worker.js
└── up.json
```

- `index.html` is required.
- `_worker.js` exports the Worker and any Durable Object classes.
- Browser assets are available to Worker code as `env.ASSETS`.
- `up.json` may request KV, D1, and Durable Object bindings:

```json
{
  "bindings": {
    "kv": ["CACHE"],
    "d1": ["DB"],
    "durableObjects": [{ "binding": "ROOMS", "className": "Room" }]
  }
}
```

Use the normal APIs in Worker code:

```js
await env.CACHE.get('key');
await env.DB.prepare('SELECT 1').first();
const room = env.ROOMS.get(env.ROOMS.idFromName('main'));
return env.ASSETS.fetch(request);
```

Do not claim R2, Workers AI, Access, Workflows, Browser Rendering, Containers, Sandboxes, or Dispatch bindings in anonymous mode. They are not in the current Temporary Account matrix.

## Publish contract

1. Keep the browser folder under 1,000 files and every file under 5 MiB.
2. Do not include credentials, private data, source maps with secrets, `.env` files, or internal-only content. The resulting URL and API are public.
3. Do not include symbolic links.
4. Test locally.
5. Ask the user to approve:
   - making the app public for up to/about 60 minutes;
   - Cloudflare’s Terms of Service and Privacy Policy;
   - the declared platform bindings.
6. After approval, deploy:

```sh
up deploy ./dist [name] --accept-cloudflare-terms
```

7. Fetch both the page and dynamic API routes. Exercise each declared binding.
8. Return the public deployment URL.
9. Return the claim URL only through the active user conversation and label it sensitive.
10. Explain that every app and binding in the temporary session disappears unless the account is claimed.

## Claim contract

```sh
up claim --open
```

The claim URL grants ownership of the entire Temporary Account. Never commit it, put it in a screenshot, send it to another agent, or include it in a public log.

## Important behavior

- No Cloudflare login or permanent API token is required.
- Up deliberately removes inherited Cloudflare credentials.
- Wrangler provisions the supported graph and may apply proof of work or rate limits.
- Use this for prototypes and review, not production or CI/CD.

## Secondary company mode

Only use company mode when the user explicitly asks for an existing private Up installation:

```sh
up private ./dist <site-name> --origin https://up.example.com
```

Company mode has a different Access-protected capability contract.
