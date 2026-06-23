import { chromium } from 'playwright';

const origin = process.env.UP_ORIGIN || 'http://127.0.0.1:8798';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto(origin, { waitUntil: 'networkidle' });
  if (browserErrors.length) throw Error(`browser hydration failed: ${browserErrors.join('; ')}`);
  if (
    !(await page
      .getByRole('heading', { name: 'Ship the whole stack. Claim it if it works.' })
      .isVisible())
  )
    throw Error('product front door missing');
  if (!(await page.getByRole('link', { name: 'Get the CLI', exact: true }).isVisible()))
    throw Error('CLI CTA missing');
  if (!(await page.getByRole('link', { name: 'See the flow', exact: true }).isVisible()))
    throw Error('tutorial CTA missing');
  if (
    !(await page
      .getByText('Independent user-land experiment. Not an official Cloudflare product.')
      .isVisible())
  )
    throw Error('independent-project qualifier missing');
  for (const name of ['Tutorial', 'How-to guides', 'Reference', 'Explanation']) {
    if (!(await page.getByRole('link', { name }).first().isVisible()))
      throw Error(`Diátaxis entry missing: ${name}`);
  }
  await page.goto(`${origin}/tutorial`);
  if (!(await page.getByRole('heading', { name: 'Deploy the stack before signup' }).isVisible()))
    throw Error('tutorial missing');
  const protectedApi = await page.request.get(`${origin}/api/sites`);
  if (![403, 503].includes(protectedApi.status()))
    throw Error(`API did not fail closed: ${protectedApi.status()}`);
  const app = await page.request.get(`${origin}/app`);
  if (![403, 503].includes(app.status())) throw Error(`app did not fail closed: ${app.status()}`);

  const noJs = await browser.newPage({ javaScriptEnabled: false });
  await noJs.goto(origin, { waitUntil: 'load' });
  if (
    !(await noJs
      .getByRole('heading', { name: 'Ship the whole stack. Claim it if it works.' })
      .isVisible())
  )
    throw Error('SSR front door missing without JavaScript');
  const description = await noJs.locator('meta[name="description"]').getAttribute('content');
  if (!description?.includes('KV, D1, and Durable Objects'))
    throw Error('SSR description metadata missing');
  const canonical = await noJs.locator('link[rel="canonical"]').getAttribute('href');
  if (canonical !== 'https://up.ax.cloudflare.dev/') throw Error('SSR canonical metadata missing');
  const structuredData = await noJs.locator('script[type="application/ld+json"]').textContent();
  if (!structuredData) throw Error('SSR structured data missing');
  JSON.parse(structuredData);
  await noJs.close();

  console.log(`Local SvelteKit SSR/browser E2E passed for ${origin}`);
} finally {
  await browser.close();
}
