# Up final naming and baseline receipt — 2026-06-17

## Repository

A clean rebuild followed by a case-insensitive repository search returned zero occurrences of the retired product identifier. This includes source, generated bundles, tests, fixtures, scripts, documentation, receipts, Wrangler templates, and the local generated production config.

The SQLite registry Durable Object was migrated in production with a one-time class rename to `UpRegistry`. Existing site, deployment, visibility, database, secret, schedule, usage, and audit state remained available after deployment. Public configuration now contains only Up class names and a clean no-op migration tag for new/existing installations.

## Production baseline

Republished `examples/baseline-site` as `baseline` through the authenticated Up publisher.

Authenticated cmux verification:

- page title: `Up baseline`
- marker: `UP BASELINE / 0.0.1`
- HTML, CSS, and JavaScript: loaded
- identity: `jcoeyman@cloudflare.com`
- `GET /__up/me`: `200` with company identity and `visibility: company`
- `GET /baseline.txt`: `200` with `UP_BASELINE_OK`

Cookie-free verification returned `302` to the protected Up session broker for:

- `/`
- `/baseline.txt`
- `/assets/site.js`
- `/__up/me`

TLS verification succeeded. No baseline bytes or identity were available anonymously.

## Final state

- Public product/docs remain anonymous `200`.
- `/app` and `/api` remain Cloudflare Access protected.
- Company/restricted sites require a signed broker session.
- Explicit public sites remain registry-controlled.
- Private R2, Worker secrets, Worker Loader limits, database isolation, and scheduler controls remain unchanged.
