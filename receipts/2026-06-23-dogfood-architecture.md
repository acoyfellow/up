# Decision: Up is pure orchestration of public Cloudflare primitives

Date: 2026-06-23
Branch: feat/anonymous-first

## Thesis (why Up exists next to cloudflare.com/drop)

`/drop` is browser drag-and-drop, static sites, on cloudflare.com, for net-new
users. Up is the opposite corner on purpose:

| | /drop | Up |
|---|---|---|
| Surface | browser | terminal / agent |
| Payload | static site | dynamic Worker + KV + D1 + DO |
| Home | cloudflare.com | independent (`up.coey.dev`) |
| Audience | new-user funnel | devs/agents who want the whole platform first |

The implementation rule that makes Up a *demonstration*, not a competitor:

> **Every Up capability is a public Cloudflare primitive invoked through Wrangler
> or a documented API. Up writes orchestration and configuration — never a
> reimplementation of a platform feature.**

If a layer can be a Cloudflare primitive, it must be. Custom code is a bug.

## Audit result (what violated the rule)

The anonymous path already obeys it (wraps Wrangler + Temporary Accounts + Workers
Static Assets). The private/company path predates the pivot and hand-rolled four
platform features:

1. Static hosting reimplemented on an R2 bucket (`core-backend.ts serveSite`).
2. A bespoke manifest → upload → activate deploy protocol (Wrangler asset upload).
3. CLI auth via custom PKCE + HMAC session cookies + a wildcard session broker
   (`wrangler login` / Access).
4. A custom credential-free capability RPC over R2/DO (`capabilities.ts`) — the
   platform bindings already *are* the capabilities.

## Target architecture (both modes are pure orchestration)

### Anonymous (default, already correct)
`up deploy ./app` → snapshot → generate `wrangler.jsonc` →
`wrangler deploy --temporary --experimental-provision`.
- compute: Worker · host: Workers Static Assets · state: KV / D1 / Durable Objects
- ownership: Wrangler's claim URL
- Up backend: none

### Private (company) — re-platformed
`up private ./app name` → `wrangler deploy` of a per-app Worker (Static Assets +
declared bindings) into a **Workers for Platforms dispatch namespace** on a real
account. A dispatcher Worker routes `name.domain` → namespace script. **Access**
on the dispatcher enforces employee-only.
- registry: the dispatch namespace (no DO registry)
- host: Workers Static Assets per script (no R2 hand-roll)
- auth: Access JWT at the dispatcher (no PKCE, no session broker)
- CLI auth: `wrangler login`

This is the same shape Cloudflare's internal drag-and-drop prototype uses, which
confirms the custom code is the seam to delete, not extend.

### Bindings, not a capability RPC
"Bindings off the shelf" means the user's own Worker calls `env.KV`, `env.DB`,
`env.ROOMS` directly. Up ships example Workers, not a mediated RPC. `capabilities.ts`,
`site-database.ts`, `site-realtime.ts` become copyable examples, not an Up runtime.

## What gets deleted

`src/core-backend.ts` (R2 host + deploy API), `src/session.ts` (PKCE/HMAC),
`src/registry.ts` (DO registry), `src/capabilities.ts` (custom RPC), and the
`ASSETS: R2Bucket` convention. The four duplicated MIME maps collapse to zero —
Static Assets sets `content-type`.

## Verification rule (Dane: "watched it run")

Each mode has a real run, not a unit assertion:
- anonymous: a live deploy to a Temporary Account that fetches the URL + every
  declared binding, then lets it expire. Gated behind explicit terms acceptance.
- private: a live deploy into a dispatch namespace that proves Access blocks
  anonymous and serves authenticated. Gated behind a human Access token + approval.

No claim ships on the homepage that lacks one of these green runs.

## Build order (independently shippable slices)

1. Anonymous deploy verified live (backs the headline; fixes the untested-promise bug).
2. Hero copy truth pass + public-exposure warning back on the hero.
3. Remove the capability RPC; docs switch to "use your bindings directly."
4. Re-platform private mode onto WFP + Access + Static Assets; delete the R2 backend.
5. Both-mode verification harness + receipts.
