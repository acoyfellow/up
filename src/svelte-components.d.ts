declare module '*.svelte' {
  import type { SvelteComponent } from 'svelte';
  import type { LegacyComponentType } from 'svelte/legacy';

  const component: LegacyComponentType;
  type component = SvelteComponent;
  export default component;
}
