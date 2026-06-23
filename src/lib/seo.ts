export const origin = 'https://up.ax.cloudflare.dev';

export type PageMetadata = {
  title: string;
  description: string;
  eyebrow: string;
  noindex?: boolean;
};

export const metadata = {
  '/': {
    title: 'Up — Deploy a Dynamic Stack Before Signup',
    description:
      'Deploy Worker code, Static Assets, KV, D1, and Durable Objects before creating a Cloudflare account. Claim the whole stack later.',
    eyebrow: 'Dynamic Worker · platform bindings · claim later',
  },
  '/tutorial': {
    title: 'Deploy a Dynamic Stack Before Signup — Up Tutorial',
    description:
      'Publish Worker code, browser assets, and platform bindings through a Temporary Account, then claim the whole graph.',
    eyebrow: 'Tutorial · deploy before signup',
  },
  '/how-to': {
    title: 'Redeploy and Claim — Up How-to Guides',
    description:
      'Iterate on a disposable deployment, protect its ownership link, and claim the temporary Cloudflare account.',
    eyebrow: 'How-to · iterate and claim',
  },
  '/examples': {
    title: 'Apps Built with Up — Examples',
    description: 'Explore small apps built with Up and inspect their framework-free source.',
    eyebrow: 'Examples · built with Up',
  },
  '/reference': {
    title: 'Up Reference — Dynamic Apps, Bindings, and Claim Semantics',
    description:
      'Exact contracts for Worker code, Static Assets, KV, D1, Durable Objects, public URLs, expiry, and account claiming.',
    eyebrow: 'Reference · anonymous deployment contract',
  },
  '/explanation': {
    title: 'Why Up Deploys the Dynamic Graph First — Architecture',
    description:
      'Understand how Temporary Accounts let agents exercise a real Worker and platform bindings before ownership.',
    eyebrow: 'Explanation · deploy before ownership',
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
