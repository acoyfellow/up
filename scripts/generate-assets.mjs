import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = process.env.INHOUSE_ORIGIN || 'http://127.0.0.1:8798';
await mkdir('public/screenshots', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const desktop = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await desktop.goto(origin, { waitUntil: 'networkidle' });
  await desktop.screenshot({ path: 'public/screenshots/desktop.png' });
  const social = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await social.goto(origin, { waitUntil: 'networkidle' });
  await social.screenshot({ path: 'public/og-card.png' });
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
  });
  await mobile.goto(origin, { waitUntil: 'networkidle' });
  await mobile.screenshot({ path: 'public/screenshots/mobile.png' });
  console.log('Generated Up screenshots and social card.');
} finally {
  await browser.close();
}
