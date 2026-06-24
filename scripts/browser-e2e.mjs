import { chromium } from 'playwright';

const origin = process.env.UP_ORIGIN || 'http://127.0.0.1:8798';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto(origin, { waitUntil: 'networkidle' });
  if (browserErrors.length) throw Error(`browser hydration failed: ${browserErrors.join('; ')}`);
  if (!(await page.getByRole('heading', { name: 'Start with a folder or a Worker.' }).isVisible()))
    throw Error('private workspace canvas missing');
  if (!(await page.getByRole('button', { name: /Drop a folder/ }).isVisible()))
    throw Error('folder drop action missing');
  if (!(await page.getByRole('button', { name: /New Worker/ }).isVisible()))
    throw Error('Worker builder action missing');
  for (const name of ['Docs', 'Source']) {
    if (!(await page.getByRole('link', { name }).first().isVisible()))
      throw Error(`tool navigation entry missing: ${name}`);
  }
  await page.getByRole('button', { name: /New Worker/ }).click();
  if (!(await page.getByRole('heading', { name: 'Build the app.' }).isVisible()))
    throw Error('Worker builder missing');
  if (!(await page.getByLabel('Worker code').isVisible())) throw Error('Worker editor missing');
  if (!(await page.getByText('Deployment runs locally').isVisible()))
    throw Error('local deployment boundary missing');
  await page.getByRole('checkbox').nth(2).check();
  await page.evaluate(() =>
    Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true }),
  );
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save project' }).click(),
  ]);
  if (!download.suggestedFilename().includes('create-my-app.sh'))
    throw Error('Worker project scaffold download missing');
  if (!(await page.getByRole('button', { name: 'Copy deploy command' }).isEnabled()))
    throw Error('deploy command not enabled after save');
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
  if (!(await noJs.getByRole('heading', { name: 'Start with a folder or a Worker.' }).isVisible()))
    throw Error('SSR workspace missing without JavaScript');
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
