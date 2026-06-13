import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { openLocalBrowser } from 'unsurf/skills/record';

const exec = promisify(execFile);
const origin = process.env.INHOUSE_CONTROL_ORIGIN || 'https://app.inhouse.coey.dev';
const profile = process.env.INHOUSE_VIDEO_PROFILE || `${process.env.HOME}/.inhouse-video-profile`;
const session = process.env.INHOUSE_VIDEO_SESSION || 'inhouse-video';
const folder = resolve(process.env.INHOUSE_VIDEO_FOLDER || 'examples/baseline-site');
const siteName = process.env.INHOUSE_VIDEO_SITE || 'baseline-video';
const output = process.env.INHOUSE_VIDEO_OUTPUT || 'artifacts/video/inhouse-publish.webm';

await mkdir(output.split('/').slice(0, -1).join('/'), { recursive: true });

async function command(...args: string[]): Promise<string> {
  const result = await exec('agent-browser', ['--session', session, ...args], {
    env: {
      ...process.env,
      AGENT_BROWSER_PROFILE: profile,
      AGENT_BROWSER_HEADED: process.env.INHOUSE_VIDEO_HEADED || 'false',
    },
  });
  return result.stdout;
}

const browser = await openLocalBrowser({
  session,
  env: {
    AGENT_BROWSER_PROFILE: profile,
    AGENT_BROWSER_HEADED: process.env.INHOUSE_VIDEO_HEADED || 'false',
  },
});

let recording = false;
try {
  await browser.goto(`${origin}/app`);
  await browser.wait(1_000);

  const currentUrl = await command('get', 'url');
  if (!currentUrl.trim().startsWith(origin)) {
    throw new Error(
      `Recording profile is not authenticated. Run bun run video:login first. Current URL: ${currentUrl.trim()}`,
    );
  }

  await browser.startRecording(output);
  recording = true;
  await browser.wait(800);

  // A webkitdirectory input only accepts a directory path, and the bound
  // Svelte handler listens for a real change event, so dispatch one.
  await command('upload', 'input[type="file"]', folder);
  await command(
    'eval',
    'document.querySelector(\'input[type="file"]\').dispatchEvent(new Event("change",{bubbles:true}))',
  );
  await browser.wait({ selector: '.selected-view', timeoutMs: 15_000 });
  await browser.wait(1_400);
  await browser.fill('input[aria-label="Site name"]', siteName);
  await browser.wait(700);

  await browser.click('.selected-view button.primary');
  await browser.wait({ selector: '.publishing-view', timeoutMs: 10_000 });
  await browser.wait({ selector: '.success-view', timeoutMs: 120_000 });
  await browser.wait(2_500);
} finally {
  if (recording) await browser.stopRecording();
  await browser.close();
}

console.log(`Wrote ${output}`);
