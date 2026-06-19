<script lang="ts">
import { origin, type PageMetadata } from './seo';

let { path, page }: { path: string; page: PageMetadata } = $props();
const canonical = $derived(`${origin}${path === '/' ? '/' : path}`);
const image = `${origin}/og-card.png`;
const schema = $derived({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareApplication',
      name: 'Up',
      applicationCategory: 'DeveloperApplication',
      description: page.description,
      url: origin,
      codeRepository: 'https://github.com/acoyfellow/up',
      license: 'https://opensource.org/license/mit',
      isAccessibleForFree: true,
      author: { '@type': 'Person', name: 'Jordan Coeyman', url: 'https://coey.dev' },
    },
    {
      '@type': 'WebPage',
      name: page.title,
      description: page.description,
      url: canonical,
      image,
      isPartOf: { '@type': 'WebSite', name: 'Up', url: origin },
    },
  ],
});
</script>

<svelte:head>
  <title>{page.title}</title>
  <meta name="description" content={page.description} />
  <meta name="robots" content={page.noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'} />
  <link rel="canonical" href={canonical} />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="icon" href="/icon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
  <link rel="alternate" href="/llms.txt" type="text/plain" />
  <meta name="theme-color" content="#ffffff" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Up" />
  <meta property="og:title" content={page.title} />
  <meta property="og:description" content={page.description} />
  <meta property="og:url" content={canonical} />
  <meta property="og:image" content={image} />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={page.title} />
  <meta name="twitter:description" content={page.description} />
  <meta name="twitter:image" content={image} />
  {@html `<script type="application/ld+json">${JSON.stringify(schema).replaceAll('<', '\\u003c')}</script>`}
</svelte:head>
