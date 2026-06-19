#!/usr/bin/env bun
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const DEFAULT_ORIGIN = 'https://up.ax.cloudflare.dev';
const command = process.argv[2];
const args = process.argv.slice(3);

function usage(): never {
  console.error(`up 0.0.1

up init [directory]
up deploy <folder> <site-name> [--origin https://up.example.com]
`);
  process.exit(1);
}

function option(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function accessToken(origin: string): string {
  if (process.env.UP_ACCESS_TOKEN) return process.env.UP_ACCESS_TOKEN;
  return execFileSync('cloudflared', ['access', 'token', '-app', origin], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

async function files(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) output.push(path);
    }
  }
  await visit(root);
  return output.sort();
}

const mime = (path: string) =>
  path.endsWith('.html')
    ? 'text/html; charset=utf-8'
    : path.endsWith('.css')
      ? 'text/css; charset=utf-8'
      : path.endsWith('.js')
        ? 'text/javascript; charset=utf-8'
        : path.endsWith('.json')
          ? 'application/json; charset=utf-8'
          : path.endsWith('.svg')
            ? 'image/svg+xml'
            : path.endsWith('.png')
              ? 'image/png'
              : path.endsWith('.jpg') || path.endsWith('.jpeg')
                ? 'image/jpeg'
                : 'application/octet-stream';

async function init(): Promise<void> {
  const target = resolve(args[0] || '.');
  const directory = join(target, '.up');
  await mkdir(directory, { recursive: true });
  const source = resolve(import.meta.dir, '..', 'skills', 'up', 'SKILL.md');
  const types = resolve(import.meta.dir, '..', 'skills', 'up', 'client.d.ts');
  await Promise.all([
    writeFile(join(directory, 'SKILL.md'), await readFile(source)),
    writeFile(join(directory, 'client.d.ts'), await readFile(types)),
  ]);
  console.log(`Initialized ${relative(process.cwd(), directory) || '.up'}

Ask your agent to read .up/SKILL.md, build into ./dist, then run:
  up deploy ./dist <site-name>`);
}

async function deploy(): Promise<void> {
  const root = resolve(args[0] || '');
  const name = args[1];
  const origin = option('--origin') || process.env.UP_ORIGIN || DEFAULT_ORIGIN;
  if (!name || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name)) usage();
  if (!(await stat(root).catch(() => null))?.isDirectory())
    throw new Error(`Folder not found: ${root}`);
  const paths = await files(root);
  if (!paths.some((path) => relative(root, path) === 'index.html'))
    throw new Error('index.html is required');
  const token = accessToken(origin);
  const authHeaders = { 'cf-access-token': token };
  const prepared = await Promise.all(
    paths.map(async (path) => {
      const bytes = await readFile(path);
      return {
        path,
        bytes,
        relative: relative(root, path).replaceAll('\\', '/'),
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }),
  );
  const manifest = prepared.map((file) => ({
    path: file.relative,
    size: file.bytes.byteLength,
    contentType: mime(file.relative),
    sha256: file.sha256,
  }));
  console.log(`Authenticated · ${prepared.length} files ready`);
  const create = await fetch(`${origin}/api/sites/${encodeURIComponent(name)}/deployments`, {
    method: 'POST',
    headers: {
      ...authHeaders,
      origin,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ manifest, access: { visibility: 'company', readers: [] } }),
  });
  const created = (await create.json()) as { deployment?: { id: string }; error?: string };
  if (!create.ok || !created.deployment)
    throw new Error(created.error || 'Unable to create deployment');
  for (let index = 0; index < prepared.length; index++) {
    const file = prepared[index];
    if (!file) continue;
    process.stdout.write(
      `\rUploading ${index + 1}/${prepared.length} ${file.relative}                    `,
    );
    const response = await fetch(
      `${origin}/api/deployments/${created.deployment.id}/assets?path=${encodeURIComponent(file.relative)}`,
      {
        method: 'PUT',
        headers: {
          ...authHeaders,
          origin,
          'sec-fetch-site': 'same-origin',
          'content-type': mime(file.relative),
        },
        body: file.bytes,
      },
    );
    if (!response.ok)
      throw new Error(((await response.json()) as { error?: string }).error || 'Upload failed');
  }
  const activate = await fetch(`${origin}/api/deployments/${created.deployment.id}/activate`, {
    method: 'POST',
    headers: { ...authHeaders, origin, 'sec-fetch-site': 'same-origin' },
  });
  const activated = (await activate.json()) as { siteUrl?: string; error?: string };
  if (!activate.ok) throw new Error(activated.error || 'Activation failed');
  console.log(
    `\nPublished\n\n${activated.siteUrl || `${name}.${new URL(origin).hostname}`}\nAccess: your organization`,
  );
}

try {
  if (command === 'init') await init();
  else if (command === 'deploy') await deploy();
  else usage();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
