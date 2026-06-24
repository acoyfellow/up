# Up end-state progress

Updated: 2026-06-24
Production boundary: personal account `bfcb6ac5b3ceaf42a09607f6f7925823` only.

## A. CLI correctness foundation

- [x] Canonical `public/` + `worker/` layout preserves Worker sibling modules; legacy flat folders remain an explicit migration path; mixed layouts/symlinks/sensitive files fail closed. Evidence: `cli/up.ts`, `tests/anonymous-cli.test.ts` canonical module-graph and mixed-layout subprocess tests.
- [x] Static-only non-interactive deploy uses generated Wrangler config and `assets.directory`; no interactive directory positional. Evidence: static subprocess captures config with no `main` and deploy invocation always uses `--config`.
- [ ] Project-scoped state with inspect/status/forget commands and no ownership-link leakage.
- [ ] Append-only Durable Object migration history across redeploys; reject class rename/deletion.

## B. Friendly new-user flow

- [ ] `up open <folder>` localhost-only inspect/plan UI.
- [ ] Redacted deploy progress, live checks, ownership open, and handoff copy.
- [ ] Expiry/error/retry, accessibility, reduced motion, and mobile evidence.

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
