#!/usr/bin/env bun
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
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

async function cliToken(origin: string): Promise<string> {
  if (process.env.UP_CLI_TOKEN) return process.env.UP_CLI_TOKEN;
  const verifier = randomBytes(48).toString('base64url');
  const digest = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(24).toString('base64url');
  const authorization = await new Promise<{ code: string; state: string }>((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url || '/', `http://${request.headers.host}`);
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      if (!code || !returnedState) {
        response.writeHead(400, { 'content-type': 'text/plain' });
        response.end('Up CLI authentication failed.');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(
        '<!doctype html><title>Up CLI connected</title><h1>Up CLI connected.</h1><p>You can close this window.</p>',
      );
      server.close();
      resolve({ code, state: returnedState });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string')
        return reject(new Error('Unable to open callback'));
      const redirect = `http://127.0.0.1:${address.port}/callback`;
      const url = new URL('/app/cli-auth', origin);
      url.searchParams.set('redirect_uri', redirect);
      url.searchParams.set('state', state);
      url.searchParams.set('challenge', digest);
      console.log(`Opening Up in your browser…\n${url}`);
      const child = spawn('open', [url.toString()], { detached: true, stdio: 'ignore' });
      child.unref();
    });
    setTimeout(
      () => {
        server.close();
        reject(new Error('CLI authentication timed out'));
      },
      5 * 60 * 1000,
    ).unref();
  });
  if (authorization.state !== state) throw new Error('CLI authentication state mismatch');
  const response = await fetch(`${origin}/cli/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: authorization.code, verifier }),
  });
  const body = (await response.json()) as { token?: string; error?: string };
  if (!response.ok || !body.token)
    throw new Error(body.error || 'Unable to exchange CLI authorization');
  return body.token;
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
  const token = await cliToken(origin);
  const authHeaders = { authorization: `Bearer ${token}` };
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
  const create = await fetch(`${origin}/cli/sites/${encodeURIComponent(name)}/deployments`, {
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
      `${origin}/cli/deployments/${created.deployment.id}/assets?path=${encodeURIComponent(file.relative)}`,
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
  const activate = await fetch(`${origin}/cli/deployments/${created.deployment.id}/activate`, {
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
