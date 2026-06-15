# Connect Up to Cloudflare

Up provisions itself into *your* Cloudflare account using the OAuth
Authorization Code flow. You approve a scoped consent screen — you never paste
or mint an API token.

## What Up requests

Least-privilege scopes, shown on Cloudflare's consent screen before you approve:

| Scope | Why |
| --- | --- |
| `access.write` | Create the Access application and policy |
| `workers-scripts.write` | Deploy the control Worker and its Durable Object |
| `workers-routes.write` | Bind the control and wildcard routes |
| `workers-r2.write` | Create and manage the private assets bucket |
| `dns.write` | Create the control-plane subdomain record |
| `zone.read` | Resolve the target zone |
| `user-details.read` | Identify the connecting operator |
| `offline_access` | Refresh the token without re-prompting |

Revoke at any time from **Manage account → OAuth authorizations** in the
Cloudflare dashboard.

## Operator path (available today)

Until the hosted one-click installer ships, connect from your machine. This is
the same flow the hosted button will run.

### 1. Register the OAuth client once

In the target account: **Manage Account → OAuth clients → Create client**
(`https://dash.cloudflare.com/?to=/:account/oauth-clients`).

- Grant type: **Authorization Code**
- Token authentication: **None (PKCE)** for the CLI, or a client secret for a server
- Redirect URL: `http://localhost:8976/callback`
- Scopes: the table above

Copy the **Client ID** (and secret, if any).

### 2. Connect

```sh
export INHOUSE_OAUTH_CLIENT_ID=<client id>
# export INHOUSE_OAUTH_CLIENT_SECRET=<secret>   # only for a confidential client
bun run oauth:connect
```

A browser opens to Cloudflare's consent screen. Approve it. The token is stored
in `.cloudflare-oauth.json` (gitignored, mode `600`) and refreshed
automatically.

### 3. Provision and deploy

```sh
export CLOUDFLARE_ACCOUNT_ID=<account id>
export INHOUSE_ALLOWED_EMAIL=you@yourcompany.com
bun run access:provision   # Access org + app + policy, private R2 bucket
bun run deploy:app         # the control Worker, behind Access
```

`access:provision` prints the `TEAM_DOMAIN` and `POLICY_AUD` to wire into
`wrangler.production.jsonc`.

## Hosted path (roadmap)

The public site will host a **Connect with Cloudflare** button that runs this
same OAuth flow with a verified public client, then provisions the tenant
server-side — zero local setup. It requires a verified client domain, which is
why the operator path above ships first.

## Security notes

- The token is scoped to exactly the permissions listed and is revocable.
- It is stored locally with `600` permissions and never committed.
- No token is shared with any third party; provisioning runs against
  `api.cloudflare.com` directly.
