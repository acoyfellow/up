# Up end-state progress

Updated: 2026-06-24
Production boundary: personal account `bfcb6ac5b3ceaf42a09607f6f7925823` only.

## A. CLI correctness foundation

- [x] Canonical `public/` + `worker/` layout preserves Worker sibling modules; legacy flat folders remain an explicit migration path; mixed layouts/symlinks/sensitive files fail closed. Evidence: `cli/up.ts`, `tests/anonymous-cli.test.ts` canonical module-graph and mixed-layout subprocess tests.
- [x] Static-only non-interactive deploy uses generated Wrangler config and `assets.directory`; no interactive directory positional. Evidence: static subprocess captures config with no `main` and deploy invocation always uses `--config`.
- [x] Project-scoped state with `inspect`/`status`/`forget` and no ownership-link leakage. Evidence: path-fingerprinted Wrangler homes under `~/.up/anonymous/projects/`; non-secret last-project pointer; local inspect JSON/human plan; status omits authority; forget is local-only; two-project isolation subprocess test.
- [x] Append-only Durable Object migration history across redeploys; reject class rename/deletion. Evidence: mode-600 `durable-object-migrations.json` per project; `v1` initial classes, `v2+` additions, unchanged preservation, pre-Wrangler removal/rename failure, and expired-account reset subprocess proof.

## B. Friendly new-user flow

- [x] `up open <folder>` localhost-only inspect/plan UI. Evidence: random unguessable path, `127.0.0.1` bind plus exact Host/path checks, no-store/CSP/frame protections, shared safe-staging inspection, exact assets/modules/bindings/exclusions, public/temporary and credential-isolation warnings, responsive/reduced-motion CSS, subprocess HTTP/404/no-state proof.
- [x] Redacted deploy progress, live checks, ownership open, and handoff copy. Evidence: separate public/Terms consent, same-origin single-flight child CLI, tokenized SSE without ownership/API secrets, metadata-derived live URL, mandatory root check plus bounded same-origin `up.json` binding checks, OS-open ownership endpoint without returning authority, and copy-ready handoff. Subprocess covers refusal, progress/result/check stream, JSON key and binding evidence, no secret leakage, and ownership response.
- [x] Expiry/error/retry, accessibility, reduced motion, and mobile evidence. Evidence: composer restores active/expired session without authority, server-sourced expiry countdown, clean redeploy/retry and partial-check states, SSE reconnect messaging, skip link, fieldset/legend, live regions, focus recovery, keyboard outlines, clipboard fallback, reduced-motion CSS, and Playwright 390×844 no-overflow/semantic checks plus expired-session subprocess proof.

## C. Full native Temporary Account shelf

- [ ] Queues.
- [ ] Hyperdrive.
- [ ] Certificates.

## D. Capa product integration

- [ ] Immutable hash-verified install artifacts.
- [ ] Same-account installer, secret input, service binding, redeploy/handoff.
- [ ] All 14 catalog bindings driven by metadata.
- [ ] Read-only GitHub connector end-to-end proof.

## E. Ownership and Access continuation

- [ ] Live ownership → Wrangler OAuth → handoff continuity proof.
- [ ] `up access` with policy diff and denial/authorized verification.
- [ ] Minimal CI token scope plan.

## F. Remove legacy / dogfood everything

- [ ] Delete bespoke private runtime and `up private`.
- [ ] Replace private/team story with platform-native deployment + Access.
- [ ] Remove unused legacy bindings from personal production after migration proof.

## G. Final evidence

- [ ] Homepage assertions map to executable evidence.
- [ ] Cross-platform CLI, browser, secret/account, live, and personal production gates.
- [ ] Independent adversarial review; no unresolved P0/P1.
- [ ] Main clean/pushed; personal production verified.
