#!/usr/bin/env bash
set -euo pipefail
fail(){ printf 'public-release check failed: %s\n' "$1" >&2; exit 1; }
tracked=$(git ls-files)
if printf '%s\n' "$tracked" | grep -Eq '(^|/)(\.env|\.dev\.vars|\.alchemy)(/|$)|\.(pem|key)$'; then fail 'secret/local-state filename tracked'; fi
if git grep -IEn '(/Users/|/home/[^/]+/|-----BEGIN (OPENSSH|PRIVATE) KEY-----|gh[opsu]_[A-Za-z0-9]{20,})' -- . ':(exclude)scripts/check-public.sh'; then fail 'local path, private key, or token-shaped value tracked'; fi
if grep -R 'REPLACE' wrangler.production.jsonc >/dev/null; then printf 'public-release note: production Access placeholders intentionally block deployment\n'; fi
printf 'public-release check passed\n'
