# Reference

## Cloudflare resources

- Worker: public docs, authenticated control API, authenticated site router
- Durable Object with SQLite: site ownership and deployment authority
- private R2 bucket: immutable deployment assets
- Cloudflare Access: organization identity boundary

## Defaults

- 500 files per deployment
- 10 MiB per file
- 50 MiB total
- `index.html` required
- site names are lowercase DNS labels; `www`, `app`, `api`, and `admin` are reserved

## Mutation requirements

Every mutation requires a verified Access identity, creator/admin authorization, exact `Origin`, and same-origin Fetch Metadata when the browser supplies it.

## Serving headers

Objects preserve their declared content type and receive `nosniff`, immutable caching except for HTML entry points, restrictive Permissions Policy, and `frame-ancestors 'none'`.
