# Private instance tool homepage — 2026-06-24

## Product correction

`up.coey.dev` is Coeyman's installed private Up instance, not a public SaaS marketing site.

The root now renders the authenticated workspace directly:

- identity: `coeyman@gmail.com`;
- primary actions: publish a private folder or open the local dynamic-app composer;
- current private deployments first when any exist;
- documentation and source are secondary navigation;
- `/app` is a compatibility redirect to `/`.

## Access boundary

Personal Cloudflare Access application `up-coey-dev` was changed from path-specific destinations (`/app`, `/api`) to the whole host `up.coey.dev`.

Read-back after update:

- domain: `up.coey.dev`;
- policy: `up-coey-dev owner`;
- decision: allow;
- include: exact email `coeyman@gmail.com`;
- exclusions: none;
- AUD unchanged: `d9e76cc54a3d8aedd2d36c6f56a8ce9e303521b593fbfbfedb096275202c0dbf`.

Anonymous requests to `/`, docs, `/app`, and APIs redirect to the personal Access tenant. Authenticated browser verification reached `/` and rendered `What do you want to run?` with the expected identity.

## Deployment

Personal account only:

- account ID: `bfcb6ac5b3ceaf42a09607f6f7925823`;
- Worker: `up-coey-dev`;
- domain: `up.coey.dev`;
- deployed version: `b51459ff-e0a7-4947-b4d9-529a84709ff0` (before final footer-only follow-up).

The interrupted Queue implementation is preserved in a named git stash and was not mixed into this pivot.
