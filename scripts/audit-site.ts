export {};

const origin = process.argv[2] || 'http://127.0.0.1:8798';
const routes = ['/', '/tutorial', '/how-to', '/reference', '/explanation'];
for (const route of routes) {
  const response = await fetch(new URL(route, origin));
  if (!response.ok) throw Error(`${route}: HTTP ${response.status}`);
  const html = await response.text();
  for (const marker of [
    '<title>',
    'name="description"',
    'rel="canonical"',
    'property="og:title"',
    'name="twitter:card"',
    'application/ld+json',
    '<h1',
  ])
    if (!html.includes(marker)) throw Error(`${route}: missing ${marker}`);
  for (const match of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gis)) {
    if (match[1]) JSON.parse(match[1]);
  }
}
for (const [path, type] of Object.entries({
  '/manifest.webmanifest': 'application/manifest+json',
  '/sw.js': 'text/javascript',
  '/robots.txt': 'text/plain',
  '/sitemap.xml': 'application/xml',
  '/llms.txt': 'text/plain',
  '/.well-known/security.txt': 'text/plain',
})) {
  const r = await fetch(new URL(path, origin));
  if (!r.ok || !r.headers.get('content-type')?.startsWith(type))
    throw Error(`${path}: invalid response`);
}
const missing = await fetch(new URL('/not-real', origin));
if (missing.status !== 404 || (await missing.text()).includes('noindex') === false)
  throw Error('404 must be real and noindexed');
console.log(`SEO/PWA audit passed for ${origin}`);
