import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const forbidden = ${JSON.stringify(credentialNames)};
if (forbidden.some((name) => process.env[name])) process.exit(41);
const args = process.argv.slice(2);
if (args[0] !== 'deploy' || !args.includes('--temporary') || !args.includes('--name') || !args.includes('--no-autoconfig') || !args.includes('--experimental-provision') || !args.includes('--experimental-auto-create')) process.exit(42);
if (!process.env.HOME?.includes('state/home') || !process.env.USERPROFILE?.includes('state/home')) process.exit(43);
if (!process.env.XDG_CONFIG_HOME?.includes('state/config') || !process.env.APPDATA?.includes('state/config') || !process.env.LOCALAPPDATA?.includes('state/config')) process.exit(44);
if (!args[1]?.includes('state/deploy-')) process.exit(45);
const name = args[args.indexOf('--name') + 1];
const directory = join(process.env.XDG_CONFIG_HOME, '.wrangler');
mkdirSync(directory, { recursive: true });
if (args.includes('--config')) writeFileSync(join(process.env.XDG_CONFIG_HOME, 'captured-config.json'), readFileSync(args[args.indexOf('--config') + 1]));
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
    // The account-wide claim URL must never be printed during deploy.
    expect(result.stdout).not.toContain('claimToken=fake-sensitive-token');
    expect(result.stdout).toContain('up claim --show');
    expect(result.stderr).not.toContain('fake-sensitive-token');
    const accountPath = join(data.state, 'config', '.wrangler', 'wrangler-temporary-account.toml');
    const accountFile = readFileSync(accountPath, 'utf8');
    expect(accountFile).toContain('temporary-secret');
    // It is stored locally instead of printed.
    expect(accountFile).toContain('claimToken=fake-sensitive-token');
    expect(readdirSync(data.state).some((name) => name.startsWith('deploy-'))).toBe(false);
    if (process.platform !== 'win32') {
      expect(statSync(data.state).mode & 0o777).toBe(0o700);
      expect(statSync(accountPath).mode & 0o777).toBe(0o600);
    }
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
      readFileSync(join(data.state, 'config', 'captured-config.json'), 'utf8'),
    );
    expect(config).toMatchObject({
      main: './_worker.js',
      assets: { directory: './assets', binding: 'ASSETS', run_worker_first: true },
      kv_namespaces: [{ binding: 'CACHE' }],
      d1_databases: [{ binding: 'DB' }],
      durable_objects: { bindings: [{ name: 'ROOMS', class_name: 'Room' }] },
      migrations: [{ tag: 'v1', new_sqlite_classes: ['Room'] }],
    });
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
    expect(existsSync(join(data.state, 'config', '.wrangler'))).toBe(false);
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
    const invalidPath = join(
      invalid.state,
      'config',
      '.wrangler',
      'wrangler-temporary-account.toml',
    );
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
    const expiredPath = join(
      expired.state,
      'config',
      '.wrangler',
      'wrangler-temporary-account.toml',
    );
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
