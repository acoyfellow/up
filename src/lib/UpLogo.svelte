<script lang="ts">
  import UpMark from './UpMark.svelte';

  let {
    size = 'nav',
    decorative = false,
  }: {
    size?: 'nav' | 'hero';
    decorative?: boolean;
  } = $props();
</script>

<span
  class="up-logo"
  class:hero={size === 'hero'}
  aria-label={decorative ? undefined : 'Up'}
  aria-hidden={decorative ? 'true' : undefined}
>
  <UpMark size={size === 'hero' ? 28 : 18} />
  <span class="word">up</span>
</span>

<style>
  .up-logo {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: #17212b;
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    font-size: 1.05rem;
    font-weight: 760;
    letter-spacing: -0.045em;
    line-height: 1;
    white-space: nowrap;
  }

  .hero {
    gap: 10px;
  }
</style>
