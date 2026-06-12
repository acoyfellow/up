import { buildHonoSvelte } from 'svelte-hono/build';

await buildHonoSvelte({
  workerEntry: './src/index.ts',
  outDir: './build',
  components: { site: './site.svelte' },
});
