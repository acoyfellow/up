export const origin = 'https://up.ax.cloudflare.dev';

export type PageMetadata = {
  title: string;
  description: string;
  eyebrow: string;
  noindex?: boolean;
};

export const metadata = {
  '/': {
    title: 'Up — Your Company’s Private Web',
    description:
      'Publish a folder to a company-private URL. Up runs in your Cloudflare account behind the identity system your organization already trusts.',
    eyebrow: 'Private sites · Cloudflare Access · your account',
  },
  '/tutorial': {
    title: 'Set Up Up on Cloudflare — Tutorial',
    description:
      'Connect Up to your Cloudflare account, establish the Access boundary, and publish a first company-private static site.',
    eyebrow: 'Tutorial · publish a private site',
  },
  '/how-to': {
    title: 'Operate Company-Private Sites — Up How-to Guides',
    description:
      'Update and verify sites, configure company identity, inspect deployment receipts, and operate Up safely on Cloudflare.',
    eyebrow: 'How-to · operate a deployment',
  },
  '/examples': {
    title: 'Apps Built with Up — Examples',
    description:
      'Explore small company-private apps built with Up and inspect their framework-free source.',
    eyebrow: 'Examples · built with Up',
  },
  '/reference': {
    title: 'Up Reference — API, Limits, and Cloudflare Resources',
    description:
      'Exact Up contracts for authenticated routes, manifests, limits, R2 keys, Durable Object state, Access identity, and headers.',
    eyebrow: 'Reference · exact contracts',
  },
  '/explanation': {
    title: 'Why Up Is Private by Default — Architecture',
    description:
      'Understand why Up uses an organization-wide Access boundary, private R2, immutable deployments, and a trusted control plane.',
    eyebrow: 'Explanation · the company trust boundary',
  },
  '/app': {
    title: 'Publish a Private Site — Up',
    description: 'Publish a static folder to your authenticated Up installation on Cloudflare.',
    eyebrow: 'Control plane · authenticated publisher',
    noindex: true,
  },
  '/offline': {
    title: 'Up is offline',
    description: 'The cached Up documentation shell is available while the network is offline.',
    eyebrow: 'Offline · cached documentation',
    noindex: true,
  },
} as const satisfies Record<string, PageMetadata>;
