#!/usr/bin/env bun
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import http from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';

const DEFAULT_ORIGIN = 'https://up.coey.dev';
const TEMPORARY_COMPATIBILITY_DATE = '2026-06-23';
const MAX_TEMPORARY_FILES = 1_000;
const MAX_TEMPORARY_FILE_BYTES = 5 * 1024 * 1024;
const command = process.argv[2];
const args = process.argv.slice(3);

function usage(): never {
  console.error(`up 0.0.1

up inspect <folder> [name]      Local preflight; no account or remote mutation
up open <folder> [name]         Open localhost-only inspect/plan composer
  --no-open                     Print URL without opening a browser
up deploy <folder> [name]       Deploy now without a Cloudflare account
  --accept-cloudflare-terms     Required for agents and non-interactive use
up status [folder]              Show local project session without ownership link
up claim [folder] [--open|--show] Open or explicitly reveal the ownership link
up forget [folder]              Remove local Up state only; never remote resources
up handoff <folder> <name>      Continue after ownership with normal Wrangler
  --account-id <id>             Claimed Cloudflare account (from wrangler whoami)
up init [directory]             Install instructions for a coding agent
up private <folder> <name>      Use a company-owned Up installation
`);
  process.exit(1);
}

function option(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

function projectFingerprint(root: string): string {
  return createHash('sha256').update(resolve(root)).digest('hex').slice(0, 16);
}

function defaultName(root: string): string {
  return `up-${projectFingerprint(root).slice(0, 10)}`;
}

function validName(name: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name);
}

function anonymousStateDirectory(): string {
  return resolve(process.env.UP_STATE_DIR || join(homedir(), '.up', 'anonymous'));
}

function anonymousPaths(projectRoot: string) {
  const base = anonymousStateDirectory();
  const root = join(base, 'projects', projectFingerprint(projectRoot));
  return {
    base,
    root,
    home: join(root, 'home'),
    config: join(root, 'config'),
    account: join(root, 'config', '.wrangler', 'wrangler-temporary-account.toml'),
    metadata: join(root, 'project.json'),
    durableMigrations: join(root, 'durable-object-migrations.json'),
    lastProject: join(base, 'last-project.json'),
  };
}

function wranglerBinary(): string {
  if (process.env.UP_WRANGLER_BIN) return resolve(process.env.UP_WRANGLER_BIN);
  const name = process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler';
  return resolve(import.meta.dir, '..', 'node_modules', '.bin', name);
}

const cloudflareCredentialVariables = [
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
] as const;

function permanentEnvironment(accountId: string): NodeJS.ProcessEnv {
  const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId };
  delete env.CF_ACCOUNT_ID;
  return env;
}

function anonymousEnvironment(
  paths: ReturnType<typeof anonymousPaths>,
  termsAccepted: boolean,
): NodeJS.ProcessEnv {
  const inherited = [
    'PATH',
    'TMPDIR',
    'TMP',
    'TEMP',
    'SHELL',
    'TERM',
    'COLORTERM',
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'NO_PROXY',
    'ALL_PROXY',
    'NODE_EXTRA_CA_CERTS',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
  ];
  const env = Object.fromEntries(
    inherited.flatMap((name) => (process.env[name] ? [[name, process.env[name]]] : [])),
  ) as NodeJS.ProcessEnv;
  Object.assign(env, {
    HOME: paths.home,
    USERPROFILE: paths.home,
    XDG_CONFIG_HOME: paths.config,
    APPDATA: paths.config,
    LOCALAPPDATA: paths.config,
    NO_COLOR: '1',
    WRANGLER_SEND_METRICS: 'false',
    ...(termsAccepted ? { CI: '1' } : {}),
  });
  for (const name of cloudflareCredentialVariables) delete env[name];
  return env;
}

const claimUrlPattern = /https:\/\/dash\.cloudflare\.com\/claim-preview\?claimToken=[^\s]+/g;

function redactClaimUrls(value: string): string {
  return value.replace(claimUrlPattern, '<sensitive claim URL withheld by Up>');
}

async function run(
  binary: string,
  childArgs: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<string> {
  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn(binary, childArgs, {
      ...options,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    let output = '';
    const relay = (stream: Readable, destination: NodeJS.WriteStream) => {
      let pending = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        output += chunk;
        pending += chunk;
        const lines = pending.split('\n');
        pending = lines.pop() || '';
        for (const line of lines) destination.write(`${redactClaimUrls(line)}\n`);
      });
      stream.on('end', () => {
        if (pending) destination.write(redactClaimUrls(pending));
      });
    };
    if (child.stdout) relay(child.stdout, process.stdout);
    if (child.stderr) relay(child.stderr, process.stderr);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise(output);
      else
        reject(new Error(`Wrangler exited ${signal ? `with ${signal}` : `with status ${code}`}`));
    });
  });
}

type BindingManifest = {
  kv: string[];
  d1: string[];
  durableObjects: Array<{ binding: string; className: string }>;
};

type DurableMigration = { tag: string; new_sqlite_classes: string[] };
type DurableMigrationState = { classes: string[]; migrations: DurableMigration[] };

type StagedFolder = {
  directory: string;
  config: string;
  fileCount: number;
  moduleCount: number;
  assetFiles: string[];
  moduleFiles: string[];
  excluded: string[];
  dynamic: boolean;
  layout: 'canonical' | 'legacy';
  bindings: BindingManifest;
  durableMigrations: DurableMigrationState;
};

type ProjectInspection = {
  projectRoot: string;
  workerName: string;
  layout: StagedFolder['layout'];
  public: true;
  temporary: true;
  accountCredentialsInherited: false;
  assets: string[];
  workerModules: string[];
  excluded: string[];
  bindings: BindingManifest;
  durableMigrations: DurableMigration[];
  command: string;
};

type ProjectMetadata = {
  projectRoot: string;
  workerName: string;
  liveUrl: string;
  deployedAt: string;
  layout: StagedFolder['layout'];
  bindings: BindingManifest;
};

const emptyBindings = (): BindingManifest => ({ kv: [], d1: [], durableObjects: [] });
const bindingNamePattern = /^[A-Z][A-Z0-9_]{0,47}$/;
const classNamePattern = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;

async function bindingManifest(root: string, dynamic: boolean): Promise<BindingManifest> {
  const path = join(root, 'up.json');
  const info = await lstat(path).catch(() => null);
  if (!info) return emptyBindings();
  if (info.isSymbolicLink()) throw new Error('Symbolic links are not supported: up.json');
  if (!info.isFile()) throw new Error('up.json must be a regular file.');
  if (info.size > 64 * 1024) throw new Error('up.json exceeds 64 KiB.');
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  let source: string;
  try {
    source = await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
  if (!source) return emptyBindings();
  if (!dynamic) throw new Error('up.json bindings require worker/index.js (or legacy _worker.js).');
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('up.json must contain valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('up.json must contain an object.');
  const rootValue = parsed as Record<string, unknown>;
  const unknownRoot = Object.keys(rootValue).filter((key) => key !== 'bindings');
  if (unknownRoot.length) throw new Error(`Unsupported up.json field: ${unknownRoot[0]}`);
  const bindingsValue = rootValue.bindings ?? {};
  if (!bindingsValue || typeof bindingsValue !== 'object' || Array.isArray(bindingsValue))
    throw new Error('up.json bindings must contain an object.');
  const bindings = bindingsValue as Record<string, unknown>;
  const unknownBindings = Object.keys(bindings).filter(
    (key) => !['kv', 'd1', 'durableObjects'].includes(key),
  );
  if (unknownBindings.length)
    throw new Error(`Unsupported anonymous binding: ${unknownBindings[0]}`);
  const names = (key: 'kv' | 'd1'): string[] => {
    const value = bindings[key] ?? [];
    if (!Array.isArray(value) || value.some((name) => typeof name !== 'string'))
      throw new Error(`up.json bindings.${key} must be an array of binding names.`);
    const output = value as string[];
    if (output.some((name) => !bindingNamePattern.test(name)))
      throw new Error(`up.json bindings.${key} contains an invalid binding name.`);
    if (new Set(output).size !== output.length)
      throw new Error(`up.json bindings.${key} contains a duplicate binding name.`);
    return output;
  };
  const durableValue = bindings.durableObjects ?? [];
  if (!Array.isArray(durableValue))
    throw new Error('up.json bindings.durableObjects must be an array.');
  const durableObjects = durableValue.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error('Each Durable Object binding must be an object.');
    const value = item as Record<string, unknown>;
    if (
      typeof value.binding !== 'string' ||
      !bindingNamePattern.test(value.binding) ||
      typeof value.className !== 'string' ||
      !classNamePattern.test(value.className)
    )
      throw new Error('Invalid Durable Object binding or class name.');
    return { binding: value.binding, className: value.className };
  });
  const manifest = { kv: names('kv'), d1: names('d1'), durableObjects };
  const allNames = [
    ...manifest.kv,
    ...manifest.d1,
    ...manifest.durableObjects.map((item) => item.binding),
  ];
  if (new Set(allNames).size !== allNames.length)
    throw new Error('Binding names must be unique across up.json.');
  return manifest;
}

async function copyStableFile(source: string, destination: string, root: string): Promise<number> {
  const info = await lstat(source);
  if (info.isSymbolicLink())
    throw new Error(`Symbolic links are not supported: ${relative(root, source)}`);
  if (!info.isFile()) throw new Error(`Unsupported file type: ${relative(root, source)}`);
  if (info.size > MAX_TEMPORARY_FILE_BYTES)
    throw new Error(`${relative(root, source)} exceeds the temporary 5 MiB file limit.`);
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  const handle = await open(source, constants.O_RDONLY | noFollow);
  try {
    const openedInfo = await handle.stat();
    if (!openedInfo.isFile() || openedInfo.size !== info.size)
      throw new Error(`File changed while staging: ${relative(root, source)}`);
    const bytes = await handle.readFile();
    if (bytes.byteLength !== openedInfo.size)
      throw new Error(`File changed while staging: ${relative(root, source)}`);
    await writeFile(destination, bytes, { mode: 0o600 });
    return bytes.byteLength;
  } finally {
    await handle.close();
  }
}

function planDurableMigrations(
  durableObjects: BindingManifest['durableObjects'],
  previous: DurableMigrationState | null,
): DurableMigrationState {
  const classes = [...new Set(durableObjects.map((item) => item.className))].sort();
  if (!previous) {
    return {
      classes,
      migrations: classes.length ? [{ tag: 'v1', new_sqlite_classes: classes }] : [],
    };
  }
  const removed = previous.classes.filter((className) => !classes.includes(className));
  if (removed.length)
    throw new Error(
      `Durable Object class removal or rename is not supported: ${removed.join(', ')}. Restore the previous class name or start a new Temporary Account with \`up forget <folder>\`.`,
    );
  const added = classes.filter((className) => !previous.classes.includes(className));
  return {
    classes,
    migrations: added.length
      ? [
          ...previous.migrations,
          { tag: `v${previous.migrations.length + 1}`, new_sqlite_classes: added },
        ]
      : previous.migrations,
  };
}

async function readDurableMigrationState(
  paths: ReturnType<typeof anonymousPaths>,
): Promise<DurableMigrationState | null> {
  const source = await readFile(paths.durableMigrations, 'utf8').catch(() => '');
  if (!source) return null;
  const parsed = JSON.parse(source) as Partial<DurableMigrationState>;
  if (!Array.isArray(parsed.classes) || !Array.isArray(parsed.migrations))
    throw new Error('Local Durable Object migration history is invalid.');
  return {
    classes: parsed.classes.filter((item): item is string => typeof item === 'string'),
    migrations: parsed.migrations.map((migration, index) => {
      if (
        !migration ||
        migration.tag !== `v${index + 1}` ||
        !Array.isArray(migration.new_sqlite_classes) ||
        migration.new_sqlite_classes.some((item) => typeof item !== 'string')
      )
        throw new Error('Local Durable Object migration history is invalid.');
      return migration;
    }),
  };
}

async function activeDurableMigrationState(
  paths: ReturnType<typeof anonymousPaths>,
): Promise<DurableMigrationState | null> {
  const account = await readTemporaryAccount(paths, true).catch(() => null);
  if (!account || Date.parse(account.accountExpiresAt) <= Date.now()) return null;
  return readDurableMigrationState(paths);
}

async function writeDurableMigrationState(
  paths: ReturnType<typeof anonymousPaths>,
  state: DurableMigrationState,
): Promise<void> {
  if (!state.migrations.length) {
    await rm(paths.durableMigrations, { force: true });
    return;
  }
  await writeFile(paths.durableMigrations, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await chmod(paths.durableMigrations, 0o600);
}

async function stageAnonymousFolder(
  root: string,
  stateRoot: string,
  previousDurableMigrations: DurableMigrationState | null = null,
): Promise<StagedFolder> {
  const directory = await mkdtemp(join(stateRoot, 'deploy-'));
  const publicPath = join(root, 'public');
  const workerDirectoryPath = join(root, 'worker');
  const legacyIndexPath = join(root, 'index.html');
  const legacyWorkerPath = join(root, '_worker.js');
  const [publicInfo, workerDirectoryInfo, legacyIndexInfo, legacyWorkerInfo] = await Promise.all([
    lstat(publicPath).catch(() => null),
    lstat(workerDirectoryPath).catch(() => null),
    lstat(legacyIndexPath).catch(() => null),
    lstat(legacyWorkerPath).catch(() => null),
  ]);

  const canonical = Boolean(publicInfo || workerDirectoryInfo);
  if (canonical && (legacyIndexInfo || legacyWorkerInfo))
    throw new Error(
      'Do not mix canonical public/ + worker/ layout with legacy root index.html or _worker.js.',
    );
  if (publicInfo?.isSymbolicLink() || workerDirectoryInfo?.isSymbolicLink())
    throw new Error('Symbolic links are not supported for public/ or worker/.');
  if (canonical && !publicInfo?.isDirectory()) throw new Error('public/ must be a directory.');
  if (workerDirectoryInfo && !workerDirectoryInfo.isDirectory())
    throw new Error('worker/ must be a directory.');
  if (legacyWorkerInfo?.isSymbolicLink())
    throw new Error('Symbolic links are not supported: _worker.js');
  if (legacyWorkerInfo && !legacyWorkerInfo.isFile())
    throw new Error('_worker.js must be a regular file.');

  const layout: StagedFolder['layout'] = canonical ? 'canonical' : 'legacy';
  const workerEntry = canonical ? join(workerDirectoryPath, 'index.js') : legacyWorkerPath;
  const workerEntryInfo = await lstat(workerEntry).catch(() => null);
  if (workerEntryInfo?.isSymbolicLink())
    throw new Error(
      `Symbolic links are not supported: ${canonical ? 'worker/index.js' : '_worker.js'}`,
    );
  if (workerEntryInfo && !workerEntryInfo.isFile())
    throw new Error(`${canonical ? 'worker/index.js' : '_worker.js'} must be a regular file.`);
  if (workerDirectoryInfo && !workerEntryInfo)
    throw new Error('worker/index.js is required when worker/ exists.');

  const dynamic = workerEntryInfo?.isFile() === true;
  const bindings = await bindingManifest(root, dynamic);
  const assetsDirectory = join(directory, 'assets');
  const stagedWorkerDirectory = join(directory, 'worker');
  await mkdir(assetsDirectory, { recursive: true, mode: 0o700 });
  if (dynamic) await mkdir(stagedWorkerDirectory, { recursive: true, mode: 0o700 });
  let fileCount = 0;
  let moduleCount = 0;
  const assetFiles: string[] = [];
  const moduleFiles: string[] = [];
  const excluded: string[] = [];
  let hasIndex = false;

  async function visit(
    sourceRoot: string,
    sourceDirectory: string,
    destinationDirectory: string,
    purpose: 'assets' | 'modules',
  ): Promise<void> {
    for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
      const source = join(sourceDirectory, entry.name);
      const sourceRelative = relative(sourceRoot, source).replaceAll('\\', '/');
      if (entry.name === '.git' || entry.name === 'node_modules') {
        excluded.push(`${relative(root, source).replaceAll('\\', '/')}/**`);
        continue;
      }
      if (
        purpose === 'assets' &&
        layout === 'legacy' &&
        ['_worker.js', 'up.json'].includes(sourceRelative)
      )
        continue;
      if (purpose === 'modules' && layout === 'legacy' && sourceRelative === 'up.json') continue;
      if (entry.name.startsWith('.') && entry.name !== '.well-known') {
        if (entry.name === '.env' || entry.name.startsWith('.env.') || entry.name === '.dev.vars')
          throw new Error(`Refusing to deploy sensitive file: ${relative(root, source)}`);
        excluded.push(relative(root, source).replaceAll('\\', '/'));
        continue;
      }
      const destination = join(destinationDirectory, entry.name);
      const info = await lstat(source);
      if (info.isSymbolicLink())
        throw new Error(`Symbolic links are not supported: ${relative(root, source)}`);
      if (info.isDirectory()) {
        await mkdir(destination, { recursive: true, mode: 0o700 });
        await visit(sourceRoot, source, destination, purpose);
        continue;
      }
      if (!info.isFile()) throw new Error(`Unsupported file type: ${relative(root, source)}`);
      if (purpose === 'assets') {
        fileCount += 1;
        if (fileCount > MAX_TEMPORARY_FILES)
          throw new Error(`Temporary deployments support at most ${MAX_TEMPORARY_FILES} assets.`);
        if (sourceRelative === 'index.html') hasIndex = true;
        assetFiles.push(relative(root, source).replaceAll('\\', '/'));
      } else {
        moduleCount += 1;
        moduleFiles.push(relative(root, source).replaceAll('\\', '/'));
      }
      await copyStableFile(source, destination, root);
    }
  }

  try {
    if (layout === 'canonical') {
      await visit(publicPath, publicPath, assetsDirectory, 'assets');
      if (dynamic)
        await visit(workerDirectoryPath, workerDirectoryPath, stagedWorkerDirectory, 'modules');
    } else {
      await visit(root, root, assetsDirectory, 'assets');
      // Legacy folders have no module/asset boundary. Copy every safe file into the
      // module tree too so sibling imports continue to resolve during migration.
      if (dynamic) await visit(root, root, stagedWorkerDirectory, 'modules');
    }
    if (!hasIndex) throw new Error(`${canonical ? 'public/index.html' : 'index.html'} is required`);

    const configPath = join(directory, 'wrangler.jsonc');
    const durableMigrations = planDurableMigrations(
      bindings.durableObjects,
      previousDurableMigrations,
    );
    const config = {
      ...(dynamic
        ? { main: layout === 'canonical' ? './worker/index.js' : './worker/_worker.js' }
        : {}),
      compatibility_date: TEMPORARY_COMPATIBILITY_DATE,
      assets: {
        directory: './assets',
        ...(dynamic ? { binding: 'ASSETS', run_worker_first: true } : {}),
      },
      ...(bindings.kv.length ? { kv_namespaces: bindings.kv.map((binding) => ({ binding })) } : {}),
      ...(bindings.d1.length ? { d1_databases: bindings.d1.map((binding) => ({ binding })) } : {}),
      ...(bindings.durableObjects.length
        ? {
            durable_objects: {
              bindings: bindings.durableObjects.map(({ binding, className }) => ({
                name: binding,
                class_name: className,
              })),
            },
            migrations: durableMigrations.migrations,
          }
        : {}),
    };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    return {
      directory,
      config: configPath,
      fileCount,
      moduleCount,
      assetFiles: [...new Set(assetFiles)].sort(),
      moduleFiles: [...new Set(moduleFiles)].sort(),
      excluded: [...new Set(excluded)].sort(),
      dynamic,
      layout,
      bindings,
      durableMigrations,
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function deploymentUrl(output: string, workerName: string): string {
  const matches = stripVTControlCharacters(output).match(/https:\/\/[^\s]+/g) || [];
  const targets = matches.flatMap((value) => {
    try {
      const url = new URL(value.replace(/[),.;]+$/, ''));
      const labels = url.hostname.toLowerCase().split('.');
      return url.protocol === 'https:' &&
        labels[0] === workerName &&
        url.hostname.toLowerCase().endsWith('.workers.dev')
        ? [url.toString().replace(/\/$/, '')]
        : [];
    } catch {
      return [];
    }
  });
  const unique = [...new Set(targets)];
  if (unique.length !== 1)
    throw new Error(
      'Wrangler deployed but did not return one authoritative workers.dev URL. Run `up claim` to recover the current account claim link before retrying.',
    );
  return unique[0] as string;
}

type TemporaryAccount = {
  accountName: string;
  accountExpiresAt: string;
  claimUrl: string;
  claimExpiresAt: string;
};

function tomlSections(source: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>();
  let current = '';
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = line.match(/^\[([^\]]+)\]$/);
    if (heading) {
      current = heading[1] || '';
      if (!sections.has(current)) sections.set(current, new Map());
      continue;
    }
    const value = line.match(/^([A-Za-z][A-Za-z0-9_]*)\s*=\s*"((?:\\.|[^"])*)"\s*$/);
    if (value && current) {
      const decoded = JSON.parse(`"${value[2]}"`) as string;
      sections.get(current)?.set(value[1] || '', decoded);
    }
  }
  return sections;
}

async function readTemporaryAccount(
  paths: ReturnType<typeof anonymousPaths>,
  allowExpired = false,
): Promise<TemporaryAccount> {
  const source = await readFile(paths.account, 'utf8').catch(() => '');
  const sections = tomlSections(source);
  const accountName = sections.get('account')?.get('name') || '';
  const accountExpiresAt = sections.get('account')?.get('expiresAt') || '';
  const claimUrl = sections.get('claim')?.get('url') || '';
  const claimExpiresAt = sections.get('claim')?.get('expiresAt') || '';
  if (!accountName || !accountExpiresAt || !claimUrl || !claimExpiresAt)
    throw new Error('No active anonymous deployment. Run `up deploy <folder>` first.');
  const accountExpiry = Date.parse(accountExpiresAt);
  const claimExpiry = Date.parse(claimExpiresAt);
  if (!Number.isFinite(accountExpiry) || !Number.isFinite(claimExpiry))
    throw new Error('The anonymous deployment state has invalid expiration data.');
  if (!allowExpired && accountExpiry <= Date.now())
    throw new Error('The anonymous deployment expired. Run `up deploy <folder>` again.');
  if (!allowExpired && claimExpiry <= Date.now())
    throw new Error('The ownership link expired. Run `up deploy <folder>` again.');
  let parsedClaim: URL;
  try {
    parsedClaim = new URL(claimUrl);
  } catch {
    throw new Error('The anonymous deployment state contains an invalid claim URL.');
  }
  if (
    parsedClaim.protocol !== 'https:' ||
    parsedClaim.hostname !== 'dash.cloudflare.com' ||
    parsedClaim.pathname !== '/claim-preview' ||
    !parsedClaim.searchParams.get('claimToken')
  )
    throw new Error('The anonymous deployment state contains an untrusted claim URL.');
  return { accountName, accountExpiresAt, claimUrl: parsedClaim.toString(), claimExpiresAt };
}

async function openUrl(url: string): Promise<boolean> {
  const invocation =
    process.platform === 'darwin'
      ? { command: 'open', args: [url] }
      : process.platform === 'win32'
        ? { command: 'cmd', args: ['/c', 'start', '', url] }
        : { command: 'xdg-open', args: [url] };
  return new Promise<boolean>((resolvePromise) => {
    const child = spawn(invocation.command, invocation.args, { detached: true, stdio: 'ignore' });
    child.once('spawn', () => {
      child.unref();
      resolvePromise(true);
    });
    child.once('error', () => resolvePromise(false));
  });
}

function minutesRemaining(timestamp: string): number {
  return Math.max(0, Math.ceil((Date.parse(timestamp) - Date.now()) / 60_000));
}

async function prepareProjectState(paths: ReturnType<typeof anonymousPaths>): Promise<void> {
  await Promise.all([
    mkdir(paths.base, { recursive: true, mode: 0o700 }),
    mkdir(paths.root, { recursive: true, mode: 0o700 }),
    mkdir(paths.home, { recursive: true, mode: 0o700 }),
    mkdir(paths.config, { recursive: true, mode: 0o700 }),
  ]);
  await Promise.all([
    chmod(paths.base, 0o700),
    chmod(paths.root, 0o700),
    chmod(paths.home, 0o700),
    chmod(paths.config, 0o700),
  ]);
}

async function writeProjectMetadata(
  paths: ReturnType<typeof anonymousPaths>,
  metadata: ProjectMetadata,
): Promise<void> {
  await writeFile(paths.metadata, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
  await writeFile(
    paths.lastProject,
    `${JSON.stringify({ projectRoot: metadata.projectRoot }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await Promise.all([chmod(paths.metadata, 0o600), chmod(paths.lastProject, 0o600)]);
}

async function readProjectMetadata(
  paths: ReturnType<typeof anonymousPaths>,
): Promise<ProjectMetadata | null> {
  const source = await readFile(paths.metadata, 'utf8').catch(() => '');
  if (!source) return null;
  const parsed = JSON.parse(source) as Partial<ProjectMetadata>;
  if (
    typeof parsed.projectRoot !== 'string' ||
    typeof parsed.workerName !== 'string' ||
    typeof parsed.liveUrl !== 'string' ||
    typeof parsed.deployedAt !== 'string' ||
    !parsed.bindings
  )
    throw new Error('Local project metadata is invalid. Run `up forget <folder>` to remove it.');
  return parsed as ProjectMetadata;
}

async function resolveSessionProject(positionals: string[]): Promise<string> {
  if (positionals.length > 1) usage();
  if (positionals[0]) return resolve(positionals[0]);
  const pointerPath = join(anonymousStateDirectory(), 'last-project.json');
  const source = await readFile(pointerPath, 'utf8').catch(() => '');
  if (source) {
    const parsed = JSON.parse(source) as { projectRoot?: unknown };
    if (typeof parsed.projectRoot === 'string') return resolve(parsed.projectRoot);
  }
  return resolve('.');
}

async function createInspection(root: string, name: string): Promise<ProjectInspection> {
  const temporary = await mkdtemp(join(tmpdir(), 'up-inspect-'));
  try {
    const staged = await stageAnonymousFolder(
      root,
      temporary,
      await activeDurableMigrationState(anonymousPaths(root)),
    );
    return {
      projectRoot: root,
      workerName: name,
      layout: staged.layout,
      public: true,
      temporary: true,
      accountCredentialsInherited: false,
      assets: staged.assetFiles,
      workerModules: staged.moduleFiles,
      excluded: staged.excluded,
      bindings: staged.bindings,
      durableMigrations: staged.durableMigrations.migrations,
      command: `up deploy ${root} ${name} --accept-cloudflare-terms`,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function inspectionArguments(flags: string[]): { root: string; name: string } {
  const positionals = args.filter((value) => !flags.includes(value));
  if (positionals.some((value) => value.startsWith('-')) || positionals.length > 2) usage();
  const root = resolve(positionals[0] || '.');
  const name = positionals[1] || defaultName(root);
  if (!validName(name)) throw new Error('Invalid Worker name.');
  return { root, name };
}

async function inspectProject(): Promise<void> {
  const { root, name } = inspectionArguments(['--json']);
  if (!(await stat(root).catch(() => null))?.isDirectory())
    throw new Error(`Folder not found: ${root}`);
  const result = await createInspection(root, name);
  if (hasFlag('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const bindingNames = [
    ...result.bindings.kv,
    ...result.bindings.d1,
    ...result.bindings.durableObjects.map((item) => item.binding),
  ];
  console.log(`Project: ${root}
Worker: ${name}
Layout: ${result.layout}
Public assets (${result.assets.length}): ${result.assets.join(', ') || 'none'}
Worker modules (${result.workerModules.length}): ${result.workerModules.join(', ') || 'none'}
Bindings: ${bindingNames.join(', ') || 'none'}
Excluded: ${result.excluded.join(', ') || 'none'}

No account was created. Existing Cloudflare credentials will not be inherited.
Deploy plan: ${result.command}`);
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ||
      character,
  );
}

function inspectionHtml(inspection: ProjectInspection): string {
  const list = (items: string[], empty: string) =>
    items.length
      ? `<ul>${items.map((item) => `<li><code>${escapeHtml(item)}</code></li>`).join('')}</ul>`
      : `<p class="empty">${empty}</p>`;
  const bindings = [
    ...inspection.bindings.kv.map((name) => `KV · ${name}`),
    ...inspection.bindings.d1.map((name) => `D1 · ${name}`),
    ...inspection.bindings.durableObjects.map(
      ({ binding, className }) => `Durable Object · ${binding} → ${className}`,
    ),
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Up · ${escapeHtml(inspection.workerName)}</title><style>
:root{color-scheme:light;--ink:#111923;--muted:#5f6f7c;--line:#d7dde1;--paper:#f5f7f8;--orange:#f6821f;--blue:#2678a4;font:16px/1.55 system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink)}main{width:min(1080px,calc(100% - 32px));margin:auto;padding:42px 0 70px}header{padding:28px 0 32px;border-bottom:1px solid var(--line)}.eyebrow{color:var(--orange);font:600 .72rem ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase}h1{max-width:760px;margin:12px 0 10px;font-size:clamp(2.2rem,6vw,4.5rem);line-height:1;letter-spacing:-.045em}header p{max-width:720px;color:var(--muted)}.warnings{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:24px 0}.warning{padding:16px;border:1px solid var(--line);border-left:4px solid var(--orange);border-radius:5px;background:var(--paper)}.warning.safe{border-left-color:#16855b}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.card{padding:22px;border:1px solid var(--line);border-radius:7px}.card h2{margin:0 0 14px;font-size:1rem}.card ul{max-height:240px;margin:0;padding-left:20px;overflow:auto}.card li{margin:6px 0}.empty{color:var(--muted)}code{font-family:ui-monospace,monospace;font-size:.82em}.plan{margin-top:16px;padding:22px;border-radius:7px;background:#0b1118;color:#fff}.plan code{display:block;overflow:auto;color:#9fd7ef;white-space:pre}.meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.meta span{padding:5px 8px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:.72rem}@media(max-width:700px){main{padding-top:18px}.grid,.warnings{grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
</style></head><body><main><header><div class="eyebrow">Local inspection · no account created</div><h1>${escapeHtml(inspection.workerName)}</h1><p>${escapeHtml(inspection.projectRoot)}</p><div class="meta"><span>${inspection.layout} layout</span><span>${inspection.assets.length} public assets</span><span>${inspection.workerModules.length} Worker modules</span><span>${bindings.length} bindings</span></div></header><section class="warnings"><div class="warning"><strong>Public and temporary</strong><br>The app and API will be public for about an hour. Do not deploy secrets or private data.</div><div class="warning safe"><strong>Your accounts stay isolated</strong><br>Up launches Wrangler in a project-only home and removes inherited Cloudflare credentials.</div></section><section class="grid"><div class="card"><h2>Public assets</h2>${list(inspection.assets, 'No public assets.')}</div><div class="card"><h2>Worker modules</h2>${list(inspection.workerModules, 'Static-only project.')}</div><div class="card"><h2>Bindings</h2>${list(bindings, 'No platform bindings.')}</div><div class="card"><h2>Excluded</h2>${list(inspection.excluded, 'Nothing excluded.')}</div></section><section class="plan"><strong>Command plan</strong><code>${escapeHtml(inspection.command)}</code></section></main></body></html>`;
}

async function openComposer(): Promise<void> {
  const { root, name } = inspectionArguments(['--no-open']);
  if (!(await stat(root).catch(() => null))?.isDirectory())
    throw new Error(`Folder not found: ${root}`);
  const inspection = await createInspection(root, name);
  const token = randomBytes(18).toString('base64url');
  const pagePath = `/${token}/`;
  const server = http.createServer((request, response) => {
    const expectedHost = `127.0.0.1:${(server.address() as { port: number }).port}`;
    if (
      request.headers.host !== expectedHost ||
      request.method !== 'GET' ||
      request.url !== pagePath
    ) {
      response.writeHead(404, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    response.end(inspectionHtml(inspection));
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to start local composer.');
  const url = `http://127.0.0.1:${address.port}${pagePath}`;
  console.log(`Up composer: ${url}\nRead-only inspection. Press Ctrl+C to stop.`);
  if (!hasFlag('--no-open')) await openUrl(url);
  const close = () => server.close();
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  await new Promise<void>((resolvePromise) => server.once('close', () => resolvePromise()));
}

async function projectStatus(): Promise<void> {
  const positionals = args.filter((value) => value !== '--json');
  if (positionals.some((value) => value.startsWith('-')) || positionals.length > 1) usage();
  const root = await resolveSessionProject(positionals);
  const paths = anonymousPaths(root);
  const metadata = await readProjectMetadata(paths);
  if (!metadata) {
    const empty = { projectRoot: root, state: 'none' };
    console.log(
      hasFlag('--json') ? JSON.stringify(empty, null, 2) : `No local Up session for ${root}`,
    );
    return;
  }
  const account = await readTemporaryAccount(paths, true);
  const active = Date.parse(account.accountExpiresAt) > Date.now();
  const result = {
    projectRoot: metadata.projectRoot,
    workerName: metadata.workerName,
    liveUrl: metadata.liveUrl,
    state: active ? 'active' : 'expired',
    expiresInMinutes: minutesRemaining(account.accountExpiresAt),
    bindings: metadata.bindings,
  };
  console.log(
    hasFlag('--json')
      ? JSON.stringify(result, null, 2)
      : `Project: ${result.projectRoot}\nWorker: ${result.workerName}\nURL: ${result.liveUrl}\nState: ${result.state}\nExpires in: ${result.expiresInMinutes} minutes\nOwnership link: stored locally, not shown`,
  );
}

async function forgetProject(): Promise<void> {
  const positionals = args.filter((value) => value !== '--yes');
  if (positionals.some((value) => value.startsWith('-')) || positionals.length > 1) usage();
  const root = await resolveSessionProject(positionals);
  const paths = anonymousPaths(root);
  await rm(paths.root, { recursive: true, force: true });
  const pointer = await readFile(paths.lastProject, 'utf8').catch(() => '');
  if (pointer) {
    const parsed = JSON.parse(pointer) as { projectRoot?: unknown };
    if (parsed.projectRoot === root) await rm(paths.lastProject, { force: true });
  }
  console.log(`Forgot local Up state for ${root}. Remote resources were not changed.`);
}

async function deployAnonymous(): Promise<void> {
  const positionals = args.filter((value) => value !== '--accept-cloudflare-terms');
  if (positionals.some((value) => value.startsWith('-')) || positionals.length > 2) usage();
  const root = resolve(positionals[0] || '');
  if (!(await stat(root).catch(() => null))?.isDirectory())
    throw new Error(`Folder not found: ${root}`);
  const explicitName = positionals[1];
  if (explicitName && !validName(explicitName)) {
    const suggestion = normalizeName(explicitName);
    throw new Error(
      `Invalid Worker name. Use lowercase letters, numbers, and hyphens${suggestion ? `, for example: ${suggestion}` : ''}.`,
    );
  }
  const name = explicitName || defaultName(root);
  const termsAccepted =
    hasFlag('--accept-cloudflare-terms') || process.env.UP_ACCEPT_CLOUDFLARE_TERMS === 'yes';
  if ((!process.stdin.isTTY || process.env.CI) && !termsAccepted)
    throw new Error(
      'Non-interactive deployment requires --accept-cloudflare-terms. This confirms acceptance of https://www.cloudflare.com/terms/ and https://www.cloudflare.com/privacypolicy/.',
    );
  if (termsAccepted)
    console.log(
      'Continuing means you accept Cloudflare’s Terms of Service (https://www.cloudflare.com/terms/) and Privacy Policy (https://www.cloudflare.com/privacypolicy/).\n',
    );

  const state = anonymousPaths(root);
  await prepareProjectState(state);

  const staged = await stageAnonymousFolder(
    root,
    state.root,
    await activeDurableMigrationState(state),
  );
  let output: string;
  try {
    const bindingNames = [
      ...staged.bindings.kv,
      ...staged.bindings.d1,
      ...staged.bindings.durableObjects.map((item) => item.binding),
    ];
    console.log(
      `Deploying ${staged.dynamic ? 'dynamic app' : 'static site'} with ${staged.fileCount} assets without a Cloudflare account${bindingNames.length ? `\nBindings: ${bindingNames.join(', ')}` : ''}…\n`,
    );
    output = await run(
      wranglerBinary(),
      [
        'deploy',
        '--config',
        staged.config,
        '--temporary',
        '--name',
        name,
        '--compatibility-date',
        TEMPORARY_COMPATIBILITY_DATE,
        '--no-autoconfig',
        '--experimental-provision',
        '--experimental-auto-create',
      ],
      { cwd: state.root, env: anonymousEnvironment(state, termsAccepted) },
    );
  } finally {
    await rm(staged.directory, { recursive: true, force: true });
  }

  const temporary = await readTemporaryAccount(state);
  const liveUrl = deploymentUrl(output, name);
  await writeDurableMigrationState(state, staged.durableMigrations);
  await writeProjectMetadata(state, {
    projectRoot: root,
    workerName: name,
    liveUrl,
    deployedAt: new Date().toISOString(),
    layout: staged.layout,
    bindings: staged.bindings,
  });
  console.log(
    `\nLive now\n\n${liveUrl}\n\nExpires in about ${minutesRemaining(temporary.accountExpiresAt)} minutes unless claimed.\nPublic: anyone with this URL can open it.\n\nKeep it: run \`up claim --open\` to open the ownership flow,\nor \`up claim --show\` to reveal the link. Up stores it locally and does not print it.`,
  );
}

async function handoff(): Promise<void> {
  const accountId = option('--account-id');
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--account-id') {
      index += 1;
      continue;
    }
    const value = args[index];
    if (!value || value.startsWith('-')) usage();
    positionals.push(value);
  }
  if (positionals.length !== 2 || !accountId || !/^[a-f0-9]{32}$/i.test(accountId)) usage();
  const root = resolve(positionals[0] as string);
  const name = positionals[1] as string;
  if (!validName(name)) throw new Error('Use the exact Worker name shown in the temporary URL.');
  if (!(await stat(root).catch(() => null))?.isDirectory())
    throw new Error(`Folder not found: ${root}`);

  const env = permanentEnvironment(accountId);
  console.log(
    'Checking the claimed account. If Wrangler is not connected yet, run `wrangler login`, then retry.\n',
  );
  try {
    await run(wranglerBinary(), ['deployments', 'status', '--name', name, '--json'], {
      cwd: root,
      env,
    });
  } catch {
    throw new Error(
      `Could not find ${name} in account ${accountId}. Run \`wrangler whoami\`, choose the account created by the ownership flow, and use the exact Worker name from its workers.dev URL. Nothing was deployed.`,
    );
  }

  const state = anonymousPaths(root);
  await prepareProjectState(state);
  const staged = await stageAnonymousFolder(
    root,
    state.root,
    await readDurableMigrationState(state),
  );
  let output: string;
  try {
    console.log(`\nContinuing ${name} from the local source folder…\n`);
    output = await run(
      wranglerBinary(),
      [
        'deploy',
        '--config',
        staged.config,
        '--name',
        name,
        '--compatibility-date',
        TEMPORARY_COMPATIBILITY_DATE,
        '--no-autoconfig',
        '--experimental-provision',
      ],
      { cwd: state.root, env },
    );
  } finally {
    await rm(staged.directory, { recursive: true, force: true });
  }

  const liveUrl = deploymentUrl(output, name);
  await writeDurableMigrationState(state, staged.durableMigrations);
  console.log(`
Handoff complete

${liveUrl}

The local folder is still the source of truth. Wrangler is now connected through OAuth; no Up API key is needed.
The URL remains public. Before adding sensitive data, add Cloudflare Access or another login and verify an anonymous request is denied.

Agent handoff prompt:
Continue this existing Cloudflare Worker from ${root}. Use account ${accountId} and Worker ${name}. Do not create replacement KV or D1 resources: preserve the existing bindings by name. Deploy with \`up handoff ${root} ${name} --account-id ${accountId}\`, test the public URL and every binding, and ask me before adding Cloudflare Access or creating a CI API token.`);
}

async function claim(): Promise<void> {
  const positionals = args.filter((value) => !['--open', '--show'].includes(value));
  if (positionals.some((value) => value.startsWith('-')) || positionals.length > 1) usage();
  const root = await resolveSessionProject(positionals);
  const temporary = await readTemporaryAccount(anonymousPaths(root));
  const minutes = minutesRemaining(temporary.claimExpiresAt);
  if (hasFlag('--open')) {
    const opened = await openUrl(temporary.claimUrl);
    console.log(
      opened
        ? `Opening the ownership flow in your browser. Claim within about ${minutes} minutes.`
        : `Could not open a browser. Run \`up claim --show\` to reveal the link (claim within about ${minutes} minutes).`,
    );
    return;
  }
  if (hasFlag('--show')) {
    console.log(
      `This ownership link claims the whole anonymous session. Treat it like a password.\nClaim within about ${minutes} minutes:\n\n${temporary.claimUrl}`,
    );
    return;
  }
  console.log(
    `Claim within about ${minutes} minutes.\nUp keeps the ownership link local and does not print it.\nRun \`up claim --open\` to open the flow, or \`up claim --show\` to reveal the link.`,
  );
}

async function cliToken(origin: string): Promise<string> {
  if (process.env.UP_CLI_TOKEN) return process.env.UP_CLI_TOKEN;
  const verifier = randomBytes(48).toString('base64url');
  const digest = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(24).toString('base64url');
  const authorization = await new Promise<{ code: string; state: string }>(
    (resolvePromise, reject) => {
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
        resolvePromise({ code, state: returnedState });
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
        void openUrl(url.toString());
      });
      setTimeout(
        () => {
          server.close();
          reject(new Error('CLI authentication timed out'));
        },
        5 * 60 * 1000,
      ).unref();
    },
  );
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

async function privateFiles(root: string): Promise<string[]> {
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
  const handoff = resolve(import.meta.dir, '..', 'skills', 'up', 'HANDOFF.md');
  const types = resolve(import.meta.dir, '..', 'skills', 'up', 'client.d.ts');
  await Promise.all([
    writeFile(join(directory, 'SKILL.md'), await readFile(source)),
    writeFile(join(directory, 'HANDOFF.md'), await readFile(handoff)),
    writeFile(join(directory, 'client.d.ts'), await readFile(types)),
  ]);
  console.log(`Initialized ${relative(process.cwd(), directory) || '.up'}

Ask your agent to read .up/SKILL.md, build into ./dist, then run:
  up deploy ./dist [name]

After you keep the app, .up/HANDOFF.md contains the continuation prompt.`);
}

async function deployPrivate(): Promise<void> {
  const root = resolve(args[0] || '');
  const name = args[1];
  const origin = option('--origin') || process.env.UP_ORIGIN || DEFAULT_ORIGIN;
  if (!name || !validName(name)) usage();
  if (!(await stat(root).catch(() => null))?.isDirectory())
    throw new Error(`Folder not found: ${root}`);
  const paths = await privateFiles(root);
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
  else if (command === 'inspect') await inspectProject();
  else if (command === 'open') await openComposer();
  else if (command === 'deploy') await deployAnonymous();
  else if (command === 'status') await projectStatus();
  else if (command === 'claim') await claim();
  else if (command === 'forget') await forgetProject();
  else if (command === 'handoff') await handoff();
  else if (command === 'private') await deployPrivate();
  else usage();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
