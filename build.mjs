import { buildHonoSvelte } from 'svelte-hono/build';

await buildHonoSvelte({
  workerEntry: './src/index.ts',
  outDir: './build',
  components: { site: './site.svelte' },
  // Svelte 5.55 emits this side-effect import for components compiled in
  // compatibility mode. Keep it in the shared import map rather than leaving
  // an unresolved bare specifier in the browser bundle.
  sharedModules: {
    'svelte/internal/flags/legacy': '../node_modules/svelte/src/internal/flags/legacy.js',
  },
});
