# Generic workspace design pass — 2026-06-24

## Direction

The installed Up homepage is generic, like an installed WordPress instance: product name and tools first; owner identity appears only in the account control.

## Empty workspace

The root is now a full-height working canvas rather than a landing page or decorative empty panel:

- drag/drop works across the canvas;
- `Drop a folder` enters the existing Access-protected publishing flow;
- `New Worker` opens an inline dynamic Worker builder;
- paint is a low-opacity edge texture, not the primary content;
- no owner name appears in title, heading, or workspace label.

## Worker builder

The browser builder includes:

- project name;
- editable `worker/index.js`;
- KV, D1, and Durable Object toggles;
- automatic `Room` export scaffolding when Durable Objects are selected;
- canonical `public/`, `worker/`, and `up.json` project output;
- File System Access save when supported;
- a portable shell-scaffold download fallback;
- deploy command enabled only after the project is saved;
- explicit note that Temporary Account deployment runs through local Wrangler.

The hosted private instance does not pretend it can invoke a user's local Wrangler. It authors the project and hands it to `up open`, whose localhost composer owns deployment consent, progress, checks, ownership, and handoff.

## Evidence

- build, Svelte check, TypeScript, Workers tests, CLI tests, browser E2E, SEO/PWA, and personal account guard passed;
- browser E2E verifies the Worker builder and scaffold download;
- Playwright at 390×844 confirms no horizontal overflow for canvas or builder;
- production target remains personal account `bfcb6ac5b3ceaf42a09607f6f7925823`, Worker `up-coey-dev`.
