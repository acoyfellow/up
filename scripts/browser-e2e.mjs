import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  if (!(await page.getByLabel('Worker code editor').isVisible()))
    throw Error('Worker editor missing');
  await page.locator('.cm-content span').first().waitFor();
  if ((await page.locator('.cm-content span').count()) < 10)
    throw Error('JavaScript syntax highlighting missing');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n// browser-e2e-edit');
  if (!(await page.locator('.cm-content').textContent())?.includes('browser-e2e-edit'))
    throw Error('Worker editor did not preserve keyboard edit');
  if (!(await page.getByText('Local Wrangler bridge').isVisible()))
    throw Error('local Wrangler bridge missing');
  if (!(await page.getByText('bunx github:acoyfellow/up bridge', { exact: true }).isVisible()))
    throw Error('bridge startup command missing');
  await page.getByRole('checkbox').nth(0).check();
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
  const downloadedPath = await download.path();
  if (!downloadedPath) throw Error('Worker project scaffold path missing');
  const scaffoldRoot = await mkdtemp(join(tmpdir(), 'up-browser-e2e-'));
  try {
    const script = await readFile(downloadedPath, 'utf8');
    if (!script.includes("mkdir -p 'my-app/public' 'my-app/worker'"))
      throw Error('canonical project directories missing from scaffold');
    execFileSync('sh', [downloadedPath], { cwd: scaffoldRoot });
    const generatedWorker = await readFile(
      join(scaffoldRoot, 'my-app', 'worker', 'index.js'),
      'utf8',
    );
    if (
      !generatedWorker.includes('browser-e2e-edit') ||
      !generatedWorker.includes('export class Room')
    )
      throw Error('edited Worker or Durable Object scaffold missing');
    const generatedManifest = JSON.parse(
      await readFile(join(scaffoldRoot, 'my-app', 'up.json'), 'utf8'),
    );
    if (
      generatedManifest.bindings?.kv?.[0] !== 'CACHE' ||
      generatedManifest.bindings?.durableObjects?.[0]?.className !== 'Room'
    )
      throw Error('selected bindings missing from scaffold');
  } finally {
    await rm(scaffoldRoot, { recursive: true, force: true });
  }
  if (!(await page.getByRole('button', { name: 'Copy local command' }).isEnabled()))
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
