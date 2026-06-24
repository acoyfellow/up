# Up

Use Up when the user wants an agent to publish and exercise a small dynamic Cloudflare app immediately, before creating or authenticating an account.

## Dynamic app contract

Build framework-free output unless the project already has a build system:

```text
dist/
├── public/
│   ├── index.html
│   └── app.js
├── worker/
│   ├── index.js
│   └── helpers.js
└── up.json
```

- `public/index.html` is required.
- `worker/index.js` is optional and exports the Worker and any Durable Object classes.
- Keep Worker imports under `worker/`; Up preserves the module graph for Wrangler.
- Browser assets under `public/` are available to Worker code as `env.ASSETS`.
- Legacy root `index.html` + `_worker.js` remains accepted for migration, but never mix layouts.
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
4. Run `up inspect ./dist [name]` or `up open ./dist [name]` and review the exact assets, Worker modules, bindings, exclusions, public/temporary warning, credential isolation, and command plan. This creates no account.
5. Test locally.
6. Ask the user to approve:
   - making the app public for up to/about 60 minutes;
   - Cloudflare’s Terms of Service and Privacy Policy;
   - the declared platform bindings.
7. After approval, deploy:

```sh
up deploy ./dist [name] --accept-cloudflare-terms
```

8. Fetch both the page and dynamic API routes. Exercise each declared binding.
9. Return the public deployment URL.
10. Do not print or repeat the ownership link. Use `up claim ./dist --open`; reveal it only when the human explicitly requests `--show`.
11. Explain that every app and binding in the project-scoped temporary session disappears unless the account is kept.

## Claim contract

```sh
up status ./dist
up claim ./dist --open
```

The ownership URL grants ownership of the entire project Temporary Account. Up stores it in project-scoped local state and withholds it by default. Never commit it, put it in a screenshot, send it to another agent, or include it in a public log. `up forget ./dist` removes only local state and never changes remote resources.

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
