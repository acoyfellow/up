<script lang="ts">
  import { page } from '$app/state';
</script>

<svelte:head>
  <title>{page.status === 404 ? 'Page not found' : 'Request failed'} — Up</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main>
  <p>{page.status}</p>
  <h1>{page.status === 404 ? 'Page not found.' : 'Request failed.'}</h1>
  <p>{page.error?.message || 'The requested page is unavailable.'}</p>
  <a href="/">Return to Up</a>
</main>

<style>
  :global(body) {
    margin: 0;
    color: #17212b;
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  }
  main {
    width: min(100% - 40px, 720px);
    margin: 12vh auto;
  }
  main > p:first-child {
    color: #f6821f;
    font: 500 0.7rem 'IBM Plex Mono', monospace;
  }
  h1 {
    margin: 18px 0;
    font-size: clamp(2.4rem, 7vw, 4.5rem);
    letter-spacing: -0.04em;
  }
  p,
  a {
    color: #5e6d79;
  }
</style>
