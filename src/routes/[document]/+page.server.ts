import { error } from '@sveltejs/kit';
import { metadata } from '$lib/seo';
import type { PageServerLoad } from './$types';

const sections = {
  tutorial: 'tutorial',
  'how-to': 'how-to',
  reference: 'reference',
  explanation: 'explanation',
  offline: 'offline',
} as const;

export const load: PageServerLoad = ({ params, setHeaders }) => {
  const section = sections[params.document as keyof typeof sections];
  const path = `/${params.document}` as keyof typeof metadata;
  const page = metadata[path];
  if (!section || !page) throw error(404, 'Page not found');
  setHeaders({ 'cache-control': 'public, max-age=0, must-revalidate' });
  return { section, path, page };
};
