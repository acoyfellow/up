<script lang="ts">
import SEO from '$lib/SEO.svelte';
import Site from '../../site.svelte';
import type { PageData } from './$types';

let { data }: { data: PageData } = $props();
</script>

<SEO path={data.path} page={data.page} />
<Site section={data.section} eyebrow={data.page.eyebrow} />
