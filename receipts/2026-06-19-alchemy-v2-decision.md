# Alchemy v2 decision — 2026-06-19

## Question

Can Alchemy v2 simplify Up's customer-owned installation graph enough to improve the seven-minute repository?

## Proof

A disposable source-only spike used the local Effect-based Alchemy v2 package (`2.0.0-beta.25`), not Alchemy 0.x. It type-checked a declarative Worker with static assets, R2, and a SQLite Durable Object while disabling `workers.dev` and previews.

No Cloudflare resource was created or modified.

## Result: ditch for this revision

Alchemy v2 does not currently provide two resources required by Up's fixed 0.0.1 graph:

- a Workers AI binding in the Worker's accepted resource union;
- Cloudflare Access application and policy resources.

Adding both through Up-specific custom providers would increase the source surface and duplicate Cloudflare API lifecycle code. That fails the reason to adopt Alchemy.

Up therefore keeps one small Wrangler installation graph for this revision. The installer may use Cloudflare OAuth, but Alchemy is not in the runtime or deploy path.

## Revisit condition

Reconsider v2 when it natively expresses:

```text
Worker + assets
R2
SQLite Durable Objects
Workers AI
custom domain and wildcard route
Cloudflare Access application and policy
no workers.dev or previews
```

At that point, adoption must delete provisioning code rather than wrap it.
