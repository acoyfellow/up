import { chromium } from 'playwright';

const origin = process.env.INHOUSE_ORIGIN || 'http://127.0.0.1:8798';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(origin, { waitUntil: 'networkidle' });
  if (!(await page.getByRole('heading', { name: /private web/i }).isVisible()))
    throw Error('homepage headline missing');
  const deploy = page.getByRole('link', { name: /deploy to cloudflare/i });
  if (!(await deploy.isVisible())) throw Error('deploy CTA missing');
  if (!(await deploy.getAttribute('href'))?.includes('deploy.workers.cloudflare.com'))
    throw Error('deploy CTA target is wrong');
  await page.goto(`${origin}/tutorial`);
  if (!(await page.getByRole('heading', { name: 'Deploy Inhouse' }).isVisible()))
    throw Error('tutorial missing');
  const protectedApi = await page.request.get(`${origin}/api/sites`);
  if (![403, 503].includes(protectedApi.status()))
    throw Error(`API did not fail closed: ${protectedApi.status()}`);
  const app = await page.request.get(`${origin}/app`);
  if (![403, 503].includes(app.status())) throw Error(`app did not fail closed: ${app.status()}`);
  console.log(`Local browser E2E passed for ${origin}`);
} finally {
  await browser.close();
}
