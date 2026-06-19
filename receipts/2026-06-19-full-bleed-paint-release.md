# Up full-bleed paint identity release — 2026-06-19

## Change

- Replaced the generated SVG paint swash with a reproducible `img-gen` raster background.
- Model: `@cf/black-forest-labs/flux-2-klein-9b`
- Seed: `19044`
- Master: `1536 × 1024`
- Production outputs: 103 KB WebP and 188 KB JPEG fallback.
- Full generation prompt and output settings: `public/images/up-hero-paint.json`.
- The hero and navbar divider now span the physical viewport; sections below retain the centered content grid.
- Mobile artwork height was reduced while preserving the full-bleed crop.
- The horizontal workflow becomes a vertical sequence on small screens instead of exposing a nested scrollbar.

## Mark system

- `UpMark.svelte` contains the two-circle inline SVG mark.
- `UpLogo.svelte` combines that mark with live HTML `up` text.
- No bitmap logo asset exists.
- The navbar uses the legible wordmark.
- The hero uses the mark abstractly: one cropped ambient pair and eight organically offset marks across the paint.
- The standalone hero wordmark was removed.

## Copy

The explanation heading `The boundary is the product` was replaced with `A URL does not grant access.` The section now names the actual identity, isolation, capability, and atomic-activation mechanisms.

## Deployment

- Source commit: `6d14ffc` — `Add full-bleed Up paint identity`
- Worker version: `ba23b497-02f2-4d0d-8399-6480bf71ea78`

## Verification

- 27/27 runtime tests passed.
- Svelte check: zero errors and zero warnings.
- TypeScript, Biome, baseline fixture, SEO/PWA audit, local browser E2E, and production dry run passed.
- Production visual probes passed at 1440, 900, 390, and 320px.
- Hero reaches both viewport edges at every tested width.
- Document width equals viewport width; no nested horizontal scrollers were present.
- Navigation contains one SVG/live-text logo; the hero contains no standalone logo and eight abstract marks.
- No logo is embedded in a bitmap.
- Anonymous `/app` and `/api` requests remain intercepted by Access.
- Anonymous wildcard site and wildcard `/icon.svg` requests return only the protected session-broker redirect with zero content bytes.
- Authenticated publisher renders both preserved sites with no browser errors or overflow.
- Post-deploy Access export remained Cloudflare employees / `@cloudflare.com` / MyIdentity SAML with unchanged `updated_at: 2026-06-18T21:42:33Z`.
