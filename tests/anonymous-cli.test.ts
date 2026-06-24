import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repository = resolve(import.meta.dirname, '..');
const cli = join(repository, 'cli', 'up.ts');
const credentialNames = [
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_KEY',
  'CLOUDFLARE_EMAIL',
  'CLOUDFLARE_API_USER_SERVICE_KEY',
  'CF_API_USER_SERVICE_KEY',
  'CF_API_TOKEN',
  'CF_ACCOUNT_ID',
  'CF_API_KEY',
  'CF_EMAIL',
];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'up-anonymous-cli-'));
  const site = join(root, 'dist');
  const state = join(root, 'state');
  const fakeWrangler = join(root, 'wrangler');
  mkdirSync(site);
  writeFileSync(join(site, 'index.html'), '<h1>Deploy first</h1>');
  writeFileSync(
    fakeWrangler,
    `#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const forbidden = ${JSON.stringify(credentialNames)};
if (forbidden.some((name) => process.env[name])) process.exit(41);
const args = process.argv.slice(2);
if (args[0] !== 'deploy' || !args.includes('--temporary') || !args.includes('--name') || !args.includes('--no-autoconfig') || !args.includes('--experimental-provision') || !args.includes('--experimental-auto-create')) process.exit(42);
if (!process.env.HOME?.includes('state/projects/') || !process.env.HOME?.endsWith('/home') || process.env.USERPROFILE !== process.env.HOME) process.exit(43);
if (!process.env.XDG_CONFIG_HOME?.includes('state/projects/') || !process.env.XDG_CONFIG_HOME?.endsWith('/config') || process.env.APPDATA !== process.env.XDG_CONFIG_HOME || process.env.LOCALAPPDATA !== process.env.XDG_CONFIG_HOME) process.exit(44);
const configPath = args[args.indexOf('--config') + 1];
if (!configPath?.includes('state/projects/') || !configPath?.includes('/deploy-')) process.exit(45);
const name = args[args.indexOf('--name') + 1];
const directory = join(process.env.XDG_CONFIG_HOME, '.wrangler');
mkdirSync(directory, { recursive: true });
const configSource = readFileSync(configPath, 'utf8');
writeFileSync(join(process.env.XDG_CONFIG_HOME, 'captured-config.json'), configSource);
const config = JSON.parse(configSource);
if (config.main) {
  writeFileSync(join(process.env.XDG_CONFIG_HOME, 'captured-main.js'), readFileSync(join(dirname(configPath), config.main)));
  const helper = join(dirname(configPath), 'worker', 'helper.js');
  if (existsSync(helper)) writeFileSync(join(process.env.XDG_CONFIG_HOME, 'captured-helper.js'), readFileSync(helper));
}
const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
writeFileSync(join(directory, 'wrangler-temporary-account.toml'), '[account]\\nname = "Display Name Is Not The Host"\\napiToken = "temporary-secret"\\nexpiresAt = "' + expires + '"\\n\\n[claim]\\nurl = "https://dash.cloudflare.com/claim-preview?claimToken=fake-sensitive-token"\\nexpiresAt = "' + expires + '"\\n', { mode: 0o600 });
console.log('Temporary account ready:');
console.log('Claim URL: https://dash.cloudflare.com/claim-preview?claimToken=fake-sensitive-token');
console.log('\\u001b[36m  https://' + name + '.authoritative-target.workers.dev\\u001b[0m');
`,
  );
  chmodSync(fakeWrangler, 0o755);
  return { root, site, state, fakeWrangler };
}

function projectState(data: ReturnType<typeof fixture>) {
  const projects = join(data.state, 'projects');
  const entries = readdirSync(projects);
  expect(entries).toHaveLength(1);
  const root = join(projects, entries[0] as string);
  return {
    root,
    config: join(root, 'config'),
    account: join(root, 'config', '.wrangler', 'wrangler-temporary-account.toml'),
    metadata: join(root, 'project.json'),
  };
}

function runCli(arguments_: string[], fixtureData: ReturnType<typeof fixture>) {
  const credentials = Object.fromEntries(
    credentialNames.map((name) => [name, 'must-not-reach-wrangler']),
  );
  return spawnSync('bun', [cli, ...arguments_], {
    cwd: repository,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...credentials,
      UP_STATE_DIR: fixtureData.state,
      UP_WRANGLER_BIN: fixtureData.fakeWrangler,
    },
  });
}

function handoffFixture() {
  const root = mkdtempSync(join(tmpdir(), 'up-handoff-cli-'));
  const site = join(root, 'app');
  const state = join(root, 'state');
  const fakeWrangler = join(root, 'wrangler');
  mkdirSync(site);
  writeFileSync(join(site, 'index.html'), '<h1>Kept app</h1>');
  writeFileSync(
    join(site, '_worker.js'),
    'export default { fetch: (r, env) => env.ASSETS.fetch(r) };',
  );
  writeFileSync(join(site, 'up.json'), JSON.stringify({ bindings: { kv: ['CACHE'], d1: ['DB'] } }));
  writeFileSync(
    fakeWrangler,
    `#!/usr/bin/env bun
import { readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const expectedAccount = '0123456789abcdef0123456789abcdef';
if (process.env.CLOUDFLARE_ACCOUNT_ID !== expectedAccount || process.env.CF_ACCOUNT_ID) process.exit(51);
if (args[0] === 'deployments' && args[1] === 'status') {
  if (args[args.indexOf('--name') + 1] !== 'kept-app') process.exit(52);
  console.log(JSON.stringify({ deployments: [{ id: 'existing' }] }));
  process.exit(0);
}
if (args[0] !== 'deploy' || args.includes('--temporary') || args.includes('--experimental-auto-create')) process.exit(53);
if (!args.includes('--experimental-provision') || args[args.indexOf('--name') + 1] !== 'kept-app') process.exit(54);
const config = JSON.parse(readFileSync(args[args.indexOf('--config') + 1], 'utf8'));
if (config.kv_namespaces[0].id || config.d1_databases[0].database_id) process.exit(55);
writeFileSync('${join(root, 'deployed')}', JSON.stringify(args));
console.log('https://kept-app.claimed-account.workers.dev');
`,
  );
  chmodSync(fakeWrangler, 0o755);
  return { root, site, state, fakeWrangler };
}

function runHandoffCli(arguments_: string[], data: ReturnType<typeof handoffFixture>) {
  return spawnSync('bun', [cli, ...arguments_], {
    cwd: repository,
    encoding: 'utf8',
    env: {
      ...process.env,
      CF_ACCOUNT_ID: 'deprecated-must-be-removed',
      CLOUDFLARE_ACCOUNT_ID: 'wrong-must-be-overridden',
      UP_STATE_DIR: data.state,
      UP_WRANGLER_BIN: data.fakeWrangler,
    },
  });
}

const accepted = '--accept-cloudflare-terms';

describe('anonymous-first CLI', () => {
  it('deploys a private staging snapshot with isolated credentials and authoritative URL', () => {
    const data = fixture();
    const result = runCli(['deploy', data.site, 'demo', accepted], data);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      'Deploying static site with 1 assets without a Cloudflare account',
    );
    expect(result.stdout).toContain('https://demo.authoritative-target.workers.dev');
    expect(result.stdout).not.toContain('https://demo.display-name-is-not-the-host.workers.dev');
    expect(result.stdout).toContain('Public: anyone with this URL can open it.');
    const paths = projectState(data);
    const staticConfig = JSON.parse(
      readFileSync(join(paths.config, 'captured-config.json'), 'utf8'),
    );
    expect(staticConfig).toMatchObject({
      assets: { directory: './assets' },
      compatibility_date: '2026-06-23',
    });
    expect(staticConfig).not.toHaveProperty('main');
    // The account-wide claim URL must never be printed during deploy.
    expect(result.stdout).not.toContain('claimToken=fake-sensitive-token');
    expect(result.stdout).toContain('up claim --show');
    expect(result.stderr).not.toContain('fake-sensitive-token');
    const accountPath = paths.account;
    const accountFile = readFileSync(accountPath, 'utf8');
    expect(accountFile).toContain('temporary-secret');
    // It is stored locally instead of printed.
    expect(accountFile).toContain('claimToken=fake-sensitive-token');
    expect(readdirSync(paths.root).some((name) => name.startsWith('deploy-'))).toBe(false);
    if (process.platform !== 'win32') {
      expect(statSync(data.state).mode & 0o777).toBe(0o700);
      expect(statSync(accountPath).mode & 0o777).toBe(0o600);
    }
  });

  it('inspects locally without creating account state or exposing credentials', () => {
    const data = fixture();
    const result = runCli(['inspect', data.site, 'inspect-demo', '--json'], data);

    expect(result.status, result.stderr).toBe(0);
    const inspected = JSON.parse(result.stdout);
    expect(inspected).toMatchObject({
      projectRoot: data.site,
      workerName: 'inspect-demo',
      layout: 'legacy',
      public: true,
      temporary: true,
      accountCredentialsInherited: false,
      assets: ['index.html'],
      workerModules: [],
      bindings: { kv: [], d1: [], durableObjects: [] },
    });
    expect(existsSync(data.state)).toBe(false);
  });

  it('opens a tokenized localhost composer, checks bindings, and opens ownership safely', async () => {
    const data = fixture();
    writeFileSync(
      join(data.site, '_worker.js'),
      `export default { fetch(request, env) { return env.ASSETS.fetch(request) } };`,
    );
    writeFileSync(
      join(data.site, 'up.json'),
      JSON.stringify({
        bindings: { kv: ['CACHE'] },
        checks: [
          {
            name: 'State API',
            path: '/api/state',
            status: 200,
            jsonKeys: ['pageViews'],
            bindings: ['CACHE'],
          },
        ],
      }),
    );
    const healthServer = http.createServer((request, response) => {
      if (request.url === '/api/state') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ pageViews: 1 }));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<h1>Live</h1>');
    });
    await new Promise<void>((resolvePromise) =>
      healthServer.listen(0, '127.0.0.1', resolvePromise),
    );
    const healthAddress = healthServer.address();
    if (!healthAddress || typeof healthAddress === 'string')
      throw new Error('health server failed');
    const child = spawn('bun', [cli, 'open', data.site, 'composer-demo', '--no-open'], {
      cwd: repository,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        UP_DISABLE_BROWSER_OPEN: 'yes',
        UP_HEALTH_CHECK_ORIGIN: `http://127.0.0.1:${healthAddress.port}`,
        UP_STATE_DIR: data.state,
        UP_WRANGLER_BIN: data.fakeWrangler,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const url = await new Promise<string>((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error(`composer timeout: ${output}`)), 10_000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const match = output.match(/Up composer: (http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+\/)/);
        if (match?.[1]) {
          clearTimeout(timer);
          resolvePromise(match[1]);
        }
      });
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code && !output.includes('Up composer:')) reject(new Error(`composer exited ${code}`));
      });
    });
    try {
      const response = await fetch(url);
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(html).toContain('Local inspection · no account created');
      expect(html).toContain('composer-demo');
      expect(html).toContain('Public and temporary');
      expect(html).toContain('Your accounts stay isolated');
      expect(html).toContain('index.html');
      expect(html).toContain('--accept-cloudflare-terms');
      expect(html).toContain('Deploy temporary app');
      expect(html).toContain('State API · GET /api/state · CACHE');
      expect(html).toContain('Copy agent handoff');
      expect(await fetch(new URL('/', url)).then((result) => result.status)).toBe(404);
      expect(existsSync(data.state)).toBe(false);

      const deployUrl = new URL('deploy', url);
      const refused = await fetch(deployUrl, {
        method: 'POST',
        headers: { origin: new URL(url).origin, 'content-type': 'application/json' },
        body: JSON.stringify({ acceptPublic: true, acceptTerms: false }),
      });
      expect(refused.status).toBe(400);

      const eventsResponse = await fetch(new URL('events', url));
      const reader = eventsResponse.body?.getReader();
      expect(reader).toBeDefined();
      const deployed = await fetch(deployUrl, {
        method: 'POST',
        headers: { origin: new URL(url).origin, 'content-type': 'application/json' },
        body: JSON.stringify({ acceptPublic: true, acceptTerms: true }),
      });
      expect(deployed.status).toBe(202);
      const decoder = new TextDecoder();
      let stream = '';
      const deadline = Date.now() + 10_000;
      while (!stream.includes('"type":"result"') && Date.now() < deadline) {
        const chunk = await Promise.race([
          reader?.read(),
          new Promise<undefined>((resolvePromise) =>
            setTimeout(() => resolvePromise(undefined), 250),
          ),
        ]);
        if (!chunk) continue;
        if (chunk.done) break;
        stream += decoder.decode(chunk.value, { stream: true });
      }
      await reader?.cancel();
      expect(stream).toContain('"type":"log"');
      expect(stream).not.toContain('claimToken=fake-sensitive-token');
      expect(stream).not.toContain('temporary-secret');
      expect(stream).toContain('"type":"check"');
      expect(stream).toContain('"name":"Public page"');
      expect(stream).toContain('"name":"State API"');
      expect(stream).toContain('"bindings":["CACHE"]');
      expect(stream).toContain('"passed":true');
      expect(stream).toContain('"type":"result"');
      expect(stream).toContain('https://composer-demo.authoritative-target.workers.dev');

      const ownership = await fetch(new URL('ownership', url), {
        method: 'POST',
        headers: { origin: new URL(url).origin, 'content-type': 'application/json' },
        body: '{}',
      });
      expect(ownership.status).toBe(202);
      expect(await ownership.text()).not.toContain('claimToken');
    } finally {
      child.kill('SIGKILL');
      await Promise.race([
        new Promise<void>((resolvePromise) => child.once('exit', () => resolvePromise())),
        new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 1_000)),
      ]);
      healthServer.closeAllConnections();
      await new Promise<void>((resolvePromise) => healthServer.close(() => resolvePromise()));
    }
  }, 20_000);

  it('isolates project status and forgets only local state without leaking ownership', () => {
    const data = fixture();
    const other = join(data.root, 'other');
    mkdirSync(other);
    writeFileSync(join(other, 'index.html'), '<h1>Other</h1>');
    expect(runCli(['deploy', data.site, 'first', accepted], data).status).toBe(0);
    expect(runCli(['deploy', other, 'second', accepted], data).status).toBe(0);
    expect(readdirSync(join(data.state, 'projects'))).toHaveLength(2);

    const firstStatus = runCli(['status', data.site, '--json'], data);
    expect(firstStatus.status, firstStatus.stderr).toBe(0);
    expect(firstStatus.stdout).not.toContain('claimToken');
    expect(JSON.parse(firstStatus.stdout)).toMatchObject({
      projectRoot: data.site,
      workerName: 'first',
      state: 'active',
    });

    const forgotten = runCli(['forget', data.site], data);
    expect(forgotten.status, forgotten.stderr).toBe(0);
    expect(forgotten.stdout).toContain('Remote resources were not changed');
    expect(readdirSync(join(data.state, 'projects'))).toHaveLength(1);
    const otherStatus = runCli(['status', other, '--json'], data);
    expect(otherStatus.status, otherStatus.stderr).toBe(0);
    expect(JSON.parse(otherStatus.stdout)).toMatchObject({ workerName: 'second', state: 'active' });
  });

  it('uses a non-identifying path fingerprint when the name is omitted', () => {
    const data = fixture();
    const deployed = runCli(['deploy', data.site, accepted], data);
    expect(deployed.status, deployed.stderr).toBe(0);
    expect(deployed.stdout).toMatch(
      /https:\/\/up-[a-f0-9]{10}\.authoritative-target\.workers\.dev/,
    );
    const result = runCli(['claim'], data);
    expect(result.status, result.stderr).toBe(0);
    // Default claim withholds the ownership link.
    expect(result.stdout).not.toContain('claimToken=fake-sensitive-token');
    expect(result.stdout).toContain('up claim --show');

    const shown = runCli(['claim', '--show'], data);
    expect(shown.status, shown.stderr).toBe(0);
    expect(shown.stdout).toContain('Treat it like a password');
    expect(shown.stdout).toContain('claimToken=fake-sensitive-token');
  });

  it('hands a claimed Worker to normal Wrangler without replacing its bindings', () => {
    const data = handoffFixture();
    const accountId = '0123456789abcdef0123456789abcdef';
    const result = runHandoffCli(
      ['handoff', data.site, 'kept-app', '--account-id', accountId],
      data,
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Handoff complete');
    expect(result.stdout).toContain('https://kept-app.claimed-account.workers.dev');
    expect(result.stdout).toContain('no Up API key is needed');
    expect(result.stdout).toContain('add Cloudflare Access or another login');
    expect(existsSync(join(data.root, 'deployed'))).toBe(true);
    expect(readdirSync(data.state).some((name) => name.startsWith('deploy-'))).toBe(false);
  });

  it('refuses handoff when the claimed Worker is not found', () => {
    const data = handoffFixture();
    const result = runHandoffCli(
      ['handoff', data.site, 'wrong-worker', '--account-id', '0123456789abcdef0123456789abcdef'],
      data,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Could not find wrong-worker');
    expect(result.stderr).toContain('Nothing was deployed');
    expect(existsSync(join(data.root, 'deployed'))).toBe(false);
  });

  it('installs an agent continuation prompt with up init', () => {
    const data = fixture();
    const project = join(data.root, 'agent-project');
    mkdirSync(project);
    const result = runCli(['init', project], data);

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(project, '.up', 'HANDOFF.md'), 'utf8')).toContain(
      'Do not create replacement KV or D1 resources',
    );
  });

  it('deploys Worker code, assets, and platform bindings as one claimable app', () => {
    const data = fixture();
    writeFileSync(
      join(data.site, '_worker.js'),
      `export class Room { fetch() { return new Response('room') } }\nexport default { fetch(request, env) { return env.ASSETS.fetch(request) } };`,
    );
    writeFileSync(
      join(data.site, 'up.json'),
      JSON.stringify({
        bindings: {
          kv: ['CACHE'],
          d1: ['DB'],
          durableObjects: [{ binding: 'ROOMS', className: 'Room' }],
        },
      }),
    );
    const result = runCli(['deploy', data.site, 'binding-lab', accepted], data);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Deploying dynamic app with 1 assets');
    expect(result.stdout).toContain('Bindings: CACHE, DB, ROOMS');
    const config = JSON.parse(
      readFileSync(join(projectState(data).config, 'captured-config.json'), 'utf8'),
    );
    expect(config).toMatchObject({
      main: './worker/_worker.js',
      assets: { directory: './assets', binding: 'ASSETS', run_worker_first: true },
      kv_namespaces: [{ binding: 'CACHE' }],
      d1_databases: [{ binding: 'DB' }],
      durable_objects: { bindings: [{ name: 'ROOMS', class_name: 'Room' }] },
      migrations: [{ tag: 'v1', new_sqlite_classes: ['Room'] }],
    });
  });

  it('appends Durable Object migrations and rejects class removal or rename', () => {
    const data = fixture();
    writeFileSync(
      join(data.site, '_worker.js'),
      `export class Room {}\nexport default { fetch(request, env) { return env.ASSETS.fetch(request) } };`,
    );
    writeFileSync(
      join(data.site, 'up.json'),
      JSON.stringify({ bindings: { durableObjects: [{ binding: 'ROOMS', className: 'Room' }] } }),
    );
    const first = runCli(['deploy', data.site, 'migration-app', accepted], data);
    expect(first.status, first.stderr).toBe(0);
    let config = JSON.parse(
      readFileSync(join(projectState(data).config, 'captured-config.json'), 'utf8'),
    );
    expect(config.migrations).toEqual([{ tag: 'v1', new_sqlite_classes: ['Room'] }]);

    writeFileSync(
      join(data.site, '_worker.js'),
      `export class Room {}\nexport class Counter {}\nexport default { fetch(request, env) { return env.ASSETS.fetch(request) } };`,
    );
    writeFileSync(
      join(data.site, 'up.json'),
      JSON.stringify({
        bindings: {
          durableObjects: [
            { binding: 'ROOMS', className: 'Room' },
            { binding: 'COUNTERS', className: 'Counter' },
          ],
        },
      }),
    );
    const second = runCli(['deploy', data.site, 'migration-app', accepted], data);
    expect(second.status, second.stderr).toBe(0);
    config = JSON.parse(
      readFileSync(join(projectState(data).config, 'captured-config.json'), 'utf8'),
    );
    expect(config.migrations).toEqual([
      { tag: 'v1', new_sqlite_classes: ['Room'] },
      { tag: 'v2', new_sqlite_classes: ['Counter'] },
    ]);

    writeFileSync(
      join(data.site, 'up.json'),
      JSON.stringify({
        bindings: { durableObjects: [{ binding: 'COUNTERS', className: 'Counter' }] },
      }),
    );
    const removed = runCli(['deploy', data.site, 'migration-app', accepted], data);
    expect(removed.status).toBe(1);
    expect(removed.stderr).toContain('class removal or rename is not supported: Room');

    const paths = projectState(data);
    writeFileSync(
      paths.account,
      readFileSync(paths.account, 'utf8').replaceAll(
        /expiresAt = "[^"]+"/g,
        'expiresAt = "2000-01-01T00:00:00.000Z"',
      ),
    );
    const freshAccount = runCli(['deploy', data.site, 'migration-app', accepted], data);
    expect(freshAccount.status, freshAccount.stderr).toBe(0);
    config = JSON.parse(readFileSync(join(paths.config, 'captured-config.json'), 'utf8'));
    expect(config.migrations).toEqual([{ tag: 'v1', new_sqlite_classes: ['Counter'] }]);
  });

  it('preserves a canonical Worker module graph outside public assets', () => {
    const data = fixture();
    rmSync(data.site, { recursive: true });
    mkdirSync(join(data.site, 'public'), { recursive: true });
    mkdirSync(join(data.site, 'worker'), { recursive: true });
    writeFileSync(join(data.site, 'public', 'index.html'), '<h1>Canonical app</h1>');
    writeFileSync(
      join(data.site, 'worker', 'index.js'),
      `import { value } from './helper.js';\nexport default { fetch() { return new Response(value) } };`,
    );
    writeFileSync(join(data.site, 'worker', 'helper.js'), `export const value = 'module-ok';`);
    const result = runCli(['deploy', data.site, 'module-app', accepted], data);

    expect(result.status, result.stderr).toBe(0);
    const paths = projectState(data);
    const config = JSON.parse(readFileSync(join(paths.config, 'captured-config.json'), 'utf8'));
    expect(config.main).toBe('./worker/index.js');
    expect(readFileSync(join(paths.config, 'captured-main.js'), 'utf8')).toContain(
      "from './helper.js'",
    );
    expect(readFileSync(join(paths.config, 'captured-helper.js'), 'utf8')).toContain('module-ok');
  });

  it('rejects mixed canonical and legacy layouts', () => {
    const data = fixture();
    mkdirSync(join(data.site, 'public'));
    writeFileSync(join(data.site, 'public', 'index.html'), '<h1>Mixed</h1>');
    const result = runCli(['deploy', data.site, 'mixed-app', accepted], data);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Do not mix canonical');
  });

  it('rejects duplicate binding declarations', () => {
    const data = fixture();
    writeFileSync(
      join(data.site, '_worker.js'),
      `export class Room {}\nexport default { fetch(request, env) { return env.ASSETS.fetch(request) } };`,
    );
    writeFileSync(
      join(data.site, 'up.json'),
      JSON.stringify({ bindings: { kv: ['CACHE', 'CACHE'] } }),
    );
    const result = runCli(['deploy', data.site, 'duplicate-bindings', accepted], data);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('duplicate binding name');
  });

  it('requires explicit Terms acceptance in non-interactive use', () => {
    const data = fixture();
    const result = runCli(['deploy', data.site, 'demo'], data);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--accept-cloudflare-terms');
    expect(existsSync(join(data.state, 'projects'))).toBe(false);
  });

  it('rejects invalid explicit names rather than silently rewriting them', () => {
    const data = fixture();
    const result = runCli(['deploy', data.site, 'Team Tool', accepted], data);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid Worker name');
    expect(result.stderr).toContain('team-tool');
  });

  it('fails before provisioning when index.html is missing', () => {
    const data = fixture();
    const empty = join(data.root, 'empty');
    mkdirSync(empty);
    writeFileSync(join(empty, 'notes.txt'), 'not a site');
    const result = runCli(['deploy', empty, 'demo', accepted], data);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('index.html is required');
  });

  it('rejects invalid, expired, or untrusted cached claim state', () => {
    const invalid = fixture();
    expect(runCli(['deploy', invalid.site, 'demo', accepted], invalid).status).toBe(0);
    const invalidPath = projectState(invalid).account;
    writeFileSync(
      invalidPath,
      readFileSync(invalidPath, 'utf8').replace(
        'https://dash.cloudflare.com/claim-preview?claimToken=fake-sensitive-token',
        'https://example.com/steal?claimToken=fake-sensitive-token',
      ),
    );
    const invalidResult = runCli(['claim'], invalid);
    expect(invalidResult.status).toBe(1);
    expect(invalidResult.stderr).toContain('untrusted claim URL');

    const expired = fixture();
    expect(runCli(['deploy', expired.site, 'demo', accepted], expired).status).toBe(0);
    const expiredPath = projectState(expired).account;
    writeFileSync(
      expiredPath,
      readFileSync(expiredPath, 'utf8').replaceAll(
        /expiresAt = "[^"]+"/g,
        'expiresAt = "2000-01-01T00:00:00.000Z"',
      ),
    );
    const expiredResult = runCli(['claim'], expired);
    expect(expiredResult.status).toBe(1);
    expect(expiredResult.stderr).toContain('expired');
  });

  it('rejects sensitive dotfiles and symbolic links', () => {
    const secret = fixture();
    writeFileSync(join(secret.site, '.env'), 'TOKEN=secret');
    const secretResult = runCli(['deploy', secret.site, 'demo', accepted], secret);
    expect(secretResult.status).toBe(1);
    expect(secretResult.stderr).toContain('Refusing to deploy sensitive file');

    if (process.platform !== 'win32') {
      const linked = fixture();
      symlinkSync(join(linked.site, 'index.html'), join(linked.site, 'copy.html'));
      const linkedResult = runCli(['deploy', linked.site, 'demo', accepted], linked);
      expect(linkedResult.status).toBe(1);
      expect(linkedResult.stderr).toContain('Symbolic links are not supported');

      const worker = fixture();
      symlinkSync(join(worker.site, 'index.html'), join(worker.site, '_worker.js'));
      const workerResult = runCli(['deploy', worker.site, 'demo', accepted], worker);
      expect(workerResult.status).toBe(1);
      expect(workerResult.stderr).toContain('Symbolic links are not supported: _worker.js');
    }
  });
});
