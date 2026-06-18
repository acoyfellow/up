import { readdir, writeFile } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

const types: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};
async function walk(d: string): Promise<string[]> {
  const es = await readdir(d, { withFileTypes: true });
  return (
    await Promise.all(es.map((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)])))
  ).flat();
}
const entries = await Promise.all(
  (await walk('public')).map(async (path) => {
    const route = `/${relative('public', path).split(sep).join('/')}`,
      bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    return [
      route,
      {
        body: Buffer.from(bytes).toString('base64'),
        type: types[extname(path)] || 'application/octet-stream',
        immutable:
          route.startsWith('/icons/') ||
          route.startsWith('/screenshots/') ||
          route.startsWith('/img/') ||
          route.startsWith('/fonts/'),
      },
    ] as const;
  }),
);
await writeFile(
  'src/public.generated.ts',
  `// Generated.\nexport const publicAssets = ${JSON.stringify(Object.fromEntries(entries))} as const;\n`,
);
