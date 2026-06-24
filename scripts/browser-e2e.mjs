import { chromium } from 'playwright';

const origin = process.env.UP_ORIGIN || 'http://127.0.0.1:8798';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto(origin, { waitUntil: 'networkidle' });
  if (browserErrors.length) throw Error(`browser hydration failed: ${browserErrors.join('; ')}`);
  if (!(await page.getByRole('heading', { name: 'What do you want to run?' }).isVisible()))
    throw Error('private tool front door missing');
  if (!(await page.getByRole('button', { name: 'Publish private folder' }).isVisible()))
    throw Error('private folder action missing');
  if (!(await page.getByText('bunx github:acoyfellow/up open ./app').isVisible()))
    throw Error('dynamic composer command missing');
  for (const name of ['Docs', 'Source']) {
    if (!(await page.getByRole('link', { name }).first().isVisible()))
      throw Error(`tool navigation entry missing: ${name}`);
  }
  await page.goto(`${origin}/tutorial`);
  if (!(await page.getByRole('heading', { name: 'Deploy the stack before signup' }).isVisible()))
    throw Error('tutorial missing');
  const protectedApi = await page.request.get(`${origin}/api/sites`);
  if (![403, 503].includes(protectedApi.status()))
    throw Error(`API did not fail closed: ${protectedApi.status()}`);
  const app = await page.request.get(`${origin}/app`, { maxRedirects: 0 });
  if (app.status() !== 308) throw Error(`legacy app route did not redirect: ${app.status()}`);

  const noJs = await browser.newPage({ javaScriptEnabled: false });
  await noJs.goto(origin, { waitUntil: 'load' });
  if (!(await noJs.getByRole('heading', { name: 'What do you want to run?' }).isVisible()))
    throw Error('SSR tool front door missing without JavaScript');
  const description = await noJs.locator('meta[name="description"]').getAttribute('content');
  if (!description?.includes('Private workspace')) throw Error('SSR description metadata missing');
  const canonical = await noJs.locator('link[rel="canonical"]').getAttribute('href');
  if (canonical !== 'https://up.coey.dev/') throw Error('SSR canonical metadata missing');
  const structuredData = await noJs.locator('script[type="application/ld+json"]').textContent();
  if (!structuredData) throw Error('SSR structured data missing');
  JSON.parse(structuredData);
  await noJs.close();

  console.log(`Local SvelteKit SSR/browser E2E passed for ${origin}`);
} finally {
  await browser.close();
}
