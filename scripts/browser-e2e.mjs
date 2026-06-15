import { chromium } from 'playwright';

const origin = process.env.INHOUSE_ORIGIN || 'http://127.0.0.1:8798';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(origin, { waitUntil: 'networkidle' });
  if (!(await page.getByRole('heading', { name: 'Your company’s private web.' }).isVisible()))
    throw Error('product front door missing');
  if (!(await page.getByRole('link', { name: 'Open Up', exact: true }).isVisible()))
    throw Error('publisher CTA missing');
  for (const name of ['Tutorial', 'How-to guides', 'Reference', 'Explanation']) {
    if (!(await page.getByRole('link', { name }).first().isVisible()))
      throw Error(`Diátaxis entry missing: ${name}`);
  }
  await page.goto(`${origin}/tutorial`);
  if (!(await page.getByRole('heading', { name: 'Set up Up' }).isVisible()))
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
