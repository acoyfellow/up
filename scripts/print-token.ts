import { resolveToken } from './lib/cf-credentials';

// Prints a usable bearer token to stdout so wrangler and ad-hoc shells can
// consume the OAuth credential: export CLOUDFLARE_API_TOKEN="$(bun run scripts/print-token.ts)"
process.stdout.write(await resolveToken());
