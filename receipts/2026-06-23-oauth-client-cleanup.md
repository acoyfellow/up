# OAuth client cleanup — 2026-06-23

The personal Cloudflare account contained two private clients named `Up CLI`, created 18 seconds apart with the same localhost callback.

- Deleted unused client: `3ac22d18b8ede8f9a8ffd254bf58bd79`
  - created `2026-06-23T09:36:36Z`
  - stale eight-scope registration
  - never selected by `.cloudflare-oauth.json`
- Retained company-mode client: `b4f7cde044f302c248e4564fb30cee6e`
  - created `2026-06-23T09:36:54Z`
  - the client used by the personal company-mode installation

The Cloudflare API returned HTTP 200 for deletion. A fresh account-scoped list returned exactly one remaining OAuth client.

The local broad OAuth credential was removed after the inventory. It had no refresh token. Direct token revocation from the shell was blocked by dashboard WAF error 1010; the short-lived token was not retained on disk. No Access application, policy, Worker, route, DNS record, R2 bucket, or production deployment was changed during OAuth-client cleanup.
