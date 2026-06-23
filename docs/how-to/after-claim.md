# After you keep an app

The ownership flow moves the whole Temporary Account to you. The Worker, Static Assets, KV, D1, Durable Objects, and their data remain available. Your source code stays in the folder where Up found it.

## 1. Connect Wrangler

Use OAuth for local work:

```sh
bunx wrangler@4.103.0 login
bunx wrangler@4.103.0 whoami
```

Complete login in the browser. You do not need an Up API key or a copied Cloudflare API key.

If `whoami` lists several accounts, identify the account created by the ownership flow and copy its 32-character account ID.

## 2. Reconnect the local source

Use the exact Worker name from the original `workers.dev` URL:

```sh
up handoff ./my-app exact-worker-name \
  --account-id 0123456789abcdef0123456789abcdef
```

Up fails before deploying unless that Worker already exists in the selected account. This protects against choosing the wrong account or changing the Worker name.

On deployment, Wrangler reads the existing Worker's settings and inherits its KV and D1 resources by binding name. Up does not auto-create replacements during handoff.

## 3. Verify continuity

Open the returned URL and test every binding that matters:

- write and read a KV value;
- insert and query a D1 row;
- call each Durable Object route;
- confirm browser assets load;
- verify existing data is still present.

The local folder remains the source of truth. Continue future deployments with the same `up handoff` command.

## 4. Decide who can open it

Keeping an app changes ownership, not visibility. The `workers.dev` URL remains public.

Before adding sensitive data, choose one:

- keep the app public;
- add [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/);
- add authentication in the application.

After adding authentication, make an anonymous request and verify it is denied or redirected. Do not rely on an unguessable URL.

## 5. Add CI only when needed

Local work should use `wrangler login`. For CI/CD, create a narrowly scoped Cloudflare API token for the selected account and deployment resources. Store it in the CI secret store, never in the app folder or `up.json`.

## Copy this to an agent

```text
Continue this existing Cloudflare Worker from ./my-app.

1. Ask me to complete `wrangler login` in the browser. Do not ask for or copy an API key.
2. Run `wrangler whoami` and ask me which account was created by the ownership flow if several are listed.
3. Use the exact Worker name from its workers.dev URL.
4. Run `up handoff ./my-app <worker-name> --account-id <account-id>`.
5. Do not create replacement KV or D1 resources. Preserve the existing bindings by name.
6. Test the deployed URL and every binding, including existing data.
7. Remind me that ownership did not make the URL private. Ask before adding Cloudflare Access or another login.
8. Create a scoped API token only if I explicitly ask for CI/CD.
```

## Recovery

| Problem | Clean next step |
|---|---|
| Wrangler is logged out | Run `wrangler login`, then retry. |
| Several accounts are listed | Ask the human which account was created by the ownership flow. |
| Worker preflight fails | Check the account ID and exact Worker name; nothing was deployed. |
| Existing data is missing | Stop. Do not provision replacements. Recheck account, Worker name, and binding names. |
| The app should be private | Add Access or application authentication, then test anonymously. |
