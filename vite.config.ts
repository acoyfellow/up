import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  ssr: {
    external: ['cloudflare:workers'],
  },
  build: {
    rollupOptions: {
      external: ['cloudflare:workers'],
    },
  },
});
