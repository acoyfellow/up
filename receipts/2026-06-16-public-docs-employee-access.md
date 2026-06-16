# Public docs and employee Access receipt — 2026-06-16

## Policy

The Up Access application was narrowed from the bare control apex to these private destinations:

- `up.ax.cloudflare.dev/app`
- `up.ax.cloudflare.dev/api`
- `*.up.ax.cloudflare.dev`

The allow policy is **Cloudflare employees**:

- Include: email domain `cloudflare.com`
- Identity provider: MyIdentity SAML only
- Instant authentication: enabled
- Session duration: 24 hours

The application AUD remained unchanged.

## Public verification

A cookie-free client received `200 text/html` for:

- `https://up.ax.cloudflare.dev/`
- `https://up.ax.cloudflare.dev/tutorial`
- `https://up.ax.cloudflare.dev/reference`

No Access Bypass policy is used. Public documentation is outside the Access application's destinations.

## Private verification

A cookie-free client received a `302` Cloudflare Access redirect for:

- `https://up.ax.cloudflare.dev/app`
- `https://up.ax.cloudflare.dev/api/sites`
- `https://baseline.up.ax.cloudflare.dev/`

The authenticated cmux in-app browser continued to render:

- the Up publisher and returning-site list as `jcoeyman@cloudflare.com`
- the published baseline site and authenticated identity

This preserves public product documentation while keeping publisher APIs and every uploaded byte company-private.
