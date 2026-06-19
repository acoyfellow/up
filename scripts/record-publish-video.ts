import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const origin = process.env.UP_VIDEO_SITE_URL || 'https://lunch-vote.up.ax.cloudflare.dev/';
const output = resolve(process.env.UP_VIDEO_OUTPUT || 'demo/up-0.0.1.mp4');
const scenes = resolve('.tmp-up-video-scenes');
await rm(scenes, { recursive: true, force: true });
await mkdir(scenes, { recursive: true });

async function cmux(...args: string[]): Promise<string> {
  const result = await exec('cmux', ['browser', ...args]);
  return result.stdout.trim();
}

const opened = await cmux('open', origin, '--focus', 'false');
const surface = opened.match(/surface=(surface:\d+)/)?.[1];
if (!surface) throw new Error(`Unable to open cmux browser: ${opened}`);
await new Promise((resolveWait) => setTimeout(resolveWait, 5_000));
if ((await cmux(surface, 'get', 'url')) !== origin)
  throw new Error('cmux browser did not reach the authenticated Up site');

async function shot(name: string): Promise<string> {
  const path = `${scenes}/${name}.png`;
  await cmux(surface, 'screenshot', '--out', path);
  return path;
}

const images: string[] = [];
images.push(await shot('01-initial'));
await cmux(surface, 'click', '--selector', '[data-choice="Salad"]');
await new Promise((resolveWait) => setTimeout(resolveWait, 1_500));
images.push(await shot('02-voted'));
await cmux(
  surface,
  'eval',
  '--script',
  `(async()=>{const response=await fetch('/_up/files/menus%2Fdemo-menu.txt',{method:'PUT',headers:{'content-type':'text/plain'},body:'Tacos, Pizza, Salad'});const saved=await response.json();const link=document.querySelector('#menu-link');link.href=saved.url;link.textContent='Open demo-menu.txt ↗';link.hidden=false;const item=document.createElement('li');item.textContent='Shared demo-menu.txt through up.files';document.querySelector('#activity').prepend(item);return JSON.stringify(saved)})()`,
);
await new Promise((resolveWait) => setTimeout(resolveWait, 900));
images.push(await shot('03-file'));
await cmux(surface, 'click', '--selector', '#summarize');
await new Promise((resolveWait) => setTimeout(resolveWait, 10_000));
images.push(await shot('04-ai'));
const errors = await cmux(surface, 'errors', 'list');
if (!errors.includes('No browser errors')) throw new Error(errors);

const durations = [2.2, 2.5, 2.8, 3.5];
const concat = images.flatMap((image, index) => [
  `file '${image.replaceAll("'", "'\\''")}'`,
  `duration ${durations[index]}`,
]);
concat.push(`file '${images.at(-1)?.replaceAll("'", "'\\''")}'`);
const manifest = `${scenes}/frames.txt`;
await writeFile(manifest, `${concat.join('\n')}\n`);
await exec('ffmpeg', [
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-f',
  'concat',
  '-safe',
  '0',
  '-i',
  manifest,
  '-vf',
  'scale=720:-2:flags=lanczos,fps=30,format=yuv420p',
  '-c:v',
  'libx264',
  '-preset',
  'slow',
  '-crf',
  '24',
  '-movflags',
  '+faststart',
  output,
]);
await rm(scenes, { recursive: true, force: true });
console.log(`Wrote ${output}`);
