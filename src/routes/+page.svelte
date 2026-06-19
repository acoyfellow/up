<script lang="ts">
import SEO from '$lib/SEO.svelte';
import { metadata } from '$lib/seo';
import Site from '../site.svelte';
</script>

<SEO path="/" page={metadata['/']} />
<Site section="home" eyebrow={metadata['/'].eyebrow} />
