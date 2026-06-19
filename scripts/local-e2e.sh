#!/usr/bin/env bash
set -euo pipefail
bun run build
bunx wrangler dev --local --port 8798 -c wrangler.local.jsonc > /tmp/up-wrangler.log 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true' EXIT
for _ in {1..60}; do curl -sf http://127.0.0.1:8798/api/health >/dev/null && break; sleep .25; done
curl -sf http://127.0.0.1:8798/api/health >/dev/null || { cat /tmp/up-wrangler.log; exit 1; }
# Wildcard requests must enter the site-serving core before SvelteKit's static
# asset manifest. A nonexistent site icon is 404, never Up's own icon.svg.
wildcard_status=$(curl -sS -o /dev/null -w '%{http_code}' --resolve missing.localhost:8798:127.0.0.1 http://missing.localhost:8798/icon.svg)
[ "$wildcard_status" = "404" ] || { echo "wildcard static asset escaped core: $wildcard_status"; exit 1; }
bun run scripts/audit-site.ts http://127.0.0.1:8798
node scripts/browser-e2e.mjs
