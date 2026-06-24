#!/usr/bin/env bash
set -euo pipefail
fail(){ printf 'public-release check failed: %s\n' "$1" >&2; exit 1; }
tracked=$(git ls-files)
if printf '%s\n' "$tracked" | grep -Eq '(^|/)(\.env|\.dev\.vars|\.alchemy)(/|$)|\.(pem|key)$'; then fail 'secret/local-state filename tracked'; fi
if git grep -IEn '(/Users/|/home/[^/]+/|-----BEGIN (OPENSSH|PRIVATE) KEY-----|gh[opsu]_[A-Za-z0-9]{20,})' -- . ':(exclude)scripts/check-public.sh'; then fail 'local path, private key, or token-shaped value tracked'; fi
if git grep -IEn '(31b91e7f9954ad8aa334d46f012bd8ed|up\.ax\.cloudflare\.dev|support-chat\.cloudflareaccess\.com|f32120a81e7d)' -- . ':(exclude)receipts/**' ':(exclude)scripts/check-public.sh'; then
  fail 'AX account or hostname present outside historical receipts'
fi
if ! grep -q '"account_id": "bfcb6ac5b3ceaf42a09607f6f7925823"' wrangler.jsonc wrangler.production.jsonc; then
  fail 'production Wrangler configs are not pinned to the personal account'
fi
printf 'public-release check passed (personal account pinned)\n'
