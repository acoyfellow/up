<script lang="ts">
  let {
    size = 18,
    primary = '#f6821f',
    satellite = '#71b8d8',
    class: className = '',
  }: {
    size?: number;
    primary?: string;
    satellite?: string;
    class?: string;
  } = $props();

  const height = $derived((size * 22) / 24);
</script>

<svg
  class={className}
  style={`width:${size}px;height:${height}px`}
  viewBox="0 0 24 22"
  role="presentation"
  aria-hidden="true"
>
  <circle cx="7" cy="14" r="6.5" fill={primary} />
  <circle cx="17.5" cy="5" r="3.5" fill={satellite} />
</svg>

<style>
  svg {
    display: block;
    flex: 0 0 auto;
    overflow: visible;
  }
</style>
