import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const root = 'examples/baseline-site';
const expected = [
  'assets/mark.svg',
  'assets/site.css',
  'assets/site.js',
  'baseline.txt',
  'index.html',
];

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? walk(path) : [path];
      }),
    )
  ).flat();
}

const actual = (await walk(root)).map((path) => relative(root, path).split(sep).join('/')).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(
    `Baseline file set changed. Expected ${expected.join(', ')}; received ${actual.join(', ')}`,
  );
}
const html = await readFile(join(root, 'index.html'), 'utf8');
for (const marker of [
  '/assets/site.css',
  '/assets/site.js',
  '/assets/mark.svg',
  'The deployment is complete.',
]) {
  if (!html.includes(marker)) throw new Error(`Baseline index is missing ${marker}`);
}
for (const source of await Promise.all(actual.map((path) => readFile(join(root, path), 'utf8')))) {
  if (/https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(source)) {
    throw new Error('Baseline must not use external network dependencies');
  }
}
console.log('Stable baseline fixture verified.');
