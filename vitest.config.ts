import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [svelte(), cloudflareTest({ wrangler: { configPath: './wrangler.test.jsonc' } })],
  test: { include: ['tests/**/*.test.ts'] },
});
