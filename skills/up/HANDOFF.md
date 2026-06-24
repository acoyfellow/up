# Continue this Up app after ownership

Fill in the app path, exact Worker name from the `workers.dev` URL, and the account ID selected by the human.

```text
Continue this existing Cloudflare Worker from <app-path>.

1. Ask me to complete `wrangler login` in the browser. Do not ask for or copy an API key.
2. Run `wrangler whoami` and ask me which account was created by the ownership flow if several are listed.
3. Use the exact Worker name from its workers.dev URL.
4. Run `up handoff <app-path> <worker-name> --account-id <account-id>`.
5. Do not create replacement KV or D1 resources. Preserve the existing bindings by name.
6. Test the deployed URL and every binding, including existing data.
7. Remind me that ownership did not make the URL private. Ask before adding Cloudflare Access or another login.
8. Create a scoped API token only if I explicitly ask for CI/CD.
```

`up handoff` refuses to deploy unless the Worker already exists in the selected account. Wrangler OAuth is the normal local credential; no Up API key is required.
