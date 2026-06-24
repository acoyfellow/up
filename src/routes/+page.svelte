<script lang="ts">
import SEO from '$lib/SEO.svelte';
import { metadata } from '$lib/seo';
import Site from '../site.svelte';
import type { PageData } from './$types';

let { data }: { data: PageData } = $props();
</script>

<SEO path="/" page={metadata['/']} />
<Site
  section="app"
  eyebrow={metadata['/'].eyebrow}
  initialIdentity={data.identity.email}
  initialSites={data.sites}
  initialSiteDomain={data.siteDomain}
  productLoaded={true}
/>
