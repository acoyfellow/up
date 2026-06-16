# Security

Report vulnerabilities privately through GitHub Security Advisories for `acoyfellow/up`. Do not file public issues for suspected exposure.

## Trust model

The public documentation contains no customer data and reads no bindings. The control plane and every site request require a valid Cloudflare Access JWT. Up independently verifies its signature, exact issuer, exact audience, and email claim before reading Durable Object or R2 state.

Uploaded sites are untrusted active JavaScript. Host them on sibling site hostnames, never on the exact control-plane origin. The control API rejects state-changing requests unless `Origin` is the exact request origin and `Sec-Fetch-Site` is `same-origin` when present.

## Production requirements

- Create Access before attaching production routes.
- Protect both the control hostname and wildcard site hostname.
- Set exact `TEAM_DOMAIN` and `POLICY_AUD` values.
- Set `workers_dev: false` and `preview_urls: false`.
- Keep R2 private and expose no direct object URL.
- Verify anonymous denial from an isolated browser after every routing or Access change.
- Never put secrets, credentials, or private data into static browser bundles.
- Treat site names, deployment IDs, object keys, and URLs as public identifiers—not capabilities.

The portable one-click deployment fails closed until Access is configured. Do not add a development auth bypass or temporarily expose the Worker to finish setup.

## Known boundary

A wildcard Access application, DNS record, and production hostname are not provisioned by Deploy to Cloudflare today. Installation is not complete until the operator creates that boundary and verifies it end to end.
