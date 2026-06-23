# Company mode: connect Cloudflare

> Secondary mode only. Anonymous `up deploy` does not require OAuth, setup, or a Cloudflare account.

Up provisions itself into *your* Cloudflare account using the OAuth
Authorization Code flow. You approve a scoped consent screen — you never paste
or mint an API token.

## What Up requests

Least-privilege scopes, shown on Cloudflare's consent screen before you approve:

| Scope | Why |
| --- | --- |
| `access.write` | Create the Access application and policy |
| `access-org.write` | Read or initialize the account Access organization |
| `workers-scripts.write` | Deploy the control Worker and its Durable Object |
| `workers-routes.write` | Bind the control and wildcard routes |
| `workers-r2.write` | Create and manage the private assets bucket |
| `dns.write` | Create wildcard and child-zone delegation records |
| `zone.read` | Resolve the target and parent zones |
| `zone.write` | Create an isolated child zone when requested |
| `user-details.read` | Identify the connecting operator |

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
export UP_OAUTH_CLIENT_ID=<client id>
# export UP_OAUTH_CLIENT_SECRET=<secret>   # only for a confidential client
bun run company:oauth:connect
```

A browser opens to Cloudflare's consent screen. Approve it. The short-lived token is stored in `.cloudflare-oauth.json` (gitignored, mode `600`). Re-run the consent command when it expires; it never asks for an API token.

### 3. Provision and deploy

```sh
export CLOUDFLARE_ACCOUNT_ID=<account id>
export UP_CONTROL_HOST=up.yourcompany.com
export UP_PARENT_ZONE=yourcompany.com
export UP_ALLOWED_EMAIL=you@yourcompany.com
bun run company:setup
```

`setup` delegates an isolated child zone when requested, creates private R2 and the Access application, reads back its generated audience, injects it into a gitignored deployment config, and deploys. No AUD is created or copied by hand.

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
