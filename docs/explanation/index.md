# Explanation: how Up decides who can open a site

A site name and URL are public identifiers. They do not authorize a request. Up serves company and restricted sites only after it verifies an identity; anonymous access begins only when the owner explicitly changes a site to public.

An installation belongs to the customer’s account. Cloudflare Access protects the publisher and supplies company identity to Up's session broker. Private R2 holds immutable assets. A Durable Object serializes deployment authority. Every site declares one visibility state: company, restricted readers, or public.

The control plane, browser content, and backend code are separate trust zones:

- browser JavaScript runs on sibling hostnames and cannot mutate the control origin cross-site
- optional `_worker.js` code runs in a separate Dynamic Worker with no global network or Up bindings
- database access is a single site-specific Durable Object stub
- secret values remain encrypted and are used only by a trusted allowlisted-request capability
- schedules are leased, quota-bound, retried, and audited by trusted code

Identifiers are never credentials. Public is explicit state, not missing authentication. Restricted denial conceals site existence. Static/company remains the default path; dynamic code, data, secrets, schedules, and public visibility are deliberate opt-ins.
