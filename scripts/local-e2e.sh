#!/usr/bin/env bash
set -euo pipefail
bun run build
bunx wrangler dev --local --port 8798 -c wrangler.local.jsonc > /tmp/inhouse-wrangler.log 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true' EXIT
for _ in {1..60}; do curl -sf http://127.0.0.1:8798/api/health >/dev/null && break; sleep .25; done
curl -sf http://127.0.0.1:8798/api/health >/dev/null || { cat /tmp/inhouse-wrangler.log; exit 1; }
bun run scripts/audit-site.ts http://127.0.0.1:8798
node scripts/browser-e2e.mjs
