#!/usr/bin/env node
// Single orchestrator for the Access-first onboarding flow.
//
// Onboarding under verification (employee → live private app):
//   1. employee runs `up private ./dist <name>`
//   2. CLI opens /app/cli-auth, employee authenticates through Cloudflare Access
//   3. PKCE code → POST /cli/exchange → short-lived deploy token
//   4. POST /cli/sites/<name>/deployments  (manifest)
//   5. PUT  /cli/deployments/<id>/assets   (per file, sha256 + size checked)
//   6. POST /cli/deployments/<id>/activate (atomic)
//   7. <name>.<domain> serves only to authenticated org members; anonymous → Access login
//
// Phases:
//   LOCAL       always. Hermetic flow tests (real DO + R2 via the workers pool)
//               plus a live boot that proves the deployed Worker fails closed.
//   PRODUCTION  gated. Read-only Access posture guard always runs when its inputs
//               are present. The real authed deploy against AX production only runs
//               with BOTH a human-minted CF_ACCESS_TOKEN and UP_ALLOW_PRODUCTION_DEPLOY=yes.
//
// Exit codes: 0 ok · 1 failure · 78 blocked (needs human input, not a failure).

import { spawn } from 'node:child_process';
import http from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

// Raw request so we can set the forbidden `Host` header (undici fetch drops it),
// which is the only way to exercise wildcard private-site routing in local dev.
function statusWithHost(port, path, host, method = 'GET') {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, path, method, headers: { host } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    request.on('error', reject);
    request.end();
  });
}

const BLOCKED = 78;
const arg = (name) => process.argv.includes(name);
const localOnly = arg('--local-only');
const productionOnly = arg('--production-only');
const skipLive = arg('--no-live');

const steps = [];
const record = (name, status, detail) => {
  steps.push({ name, status, detail });
  const icon = status === 'ok' ? '✓' : status === 'blocked' ? '▷' : '✗';
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ''}`);
};

function run(command, args, { env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      out += d;
    });
    child.on('close', (code) => resolve({ code, out }));
    child.on('error', (error) => resolve({ code: 1, out: String(error) }));
  });
}

async function expect(label, promise, predicate) {
  try {
    const value = await promise;
    if (predicate(value)) return true;
    record(label, 'fail', `unexpected ${JSON.stringify(value)}`);
    return false;
  } catch (error) {
    record(label, 'fail', error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function status(url, init) {
  const response = await fetch(url, { redirect: 'manual', ...init });
  return response.status;
}

// ── LOCAL ────────────────────────────────────────────────────────────────────
async function local() {
  const tests = await run('bun', ['run', 'test:workers']);
  if (tests.code !== 0) {
    record('local: onboarding flow tests', 'fail', 'see output below');
    console.log(tests.out.split('\n').slice(-25).join('\n'));
    return false;
  }
  const passed = (tests.out.match(/Tests\s+(\d+)\s+passed/) || [])[1] || 'all';
  record('local: onboarding flow tests', 'ok', `${passed} passed (deploy→activate→serve→Access)`);

  if (skipLive) {
    record('local: live fail-closed boot', 'blocked', '--no-live');
    return true;
  }

  const build = await run('bun', ['run', 'build']);
  if (build.code !== 0) {
    record('local: build', 'fail', 'see output below');
    console.log(build.out.split('\n').slice(-25).join('\n'));
    return false;
  }
  record('local: build', 'ok');

  const port = 8799;
  const server = spawn(
    'bunx',
    ['wrangler', 'dev', '--local', '--port', String(port), '-c', 'wrangler.local.jsonc'],
    { stdio: 'ignore', env: process.env },
  );
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try {
        const r = await fetch(`${base}/api/health`);
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {}
      await sleep(250);
    }
    if (!ready) {
      record('local: live fail-closed boot', 'fail', 'worker did not become ready');
      return false;
    }

    const ok = (
      await Promise.all([
        expect(
          'local: /api/health live',
          fetch(`${base}/api/health`).then((r) => r.json()),
          (b) => b.edge === 'ok' && b.accessConfigured === false,
        ),
        expect(
          'local: control API rejects unauthenticated',
          status(`${base}/api/sites`),
          (s) => s === 503 || s === 403,
        ),
        expect(
          'local: CLI deploy rejects without token',
          status(`${base}/cli/sites/demo/deployments`, { method: 'POST' }),
          (s) => s === 401 || s === 503,
        ),
        expect(
          'local: unknown private site never serves',
          statusWithHost(port, '/', 'demo.localhost'),
          (s) => s === 404 || s === 302,
        ),
      ])
    ).every(Boolean);

    if (ok) record('local: live fail-closed boot', 'ok', 'gate verified, no auth bypass');
    return ok;
  } finally {
    server.kill('SIGTERM');
  }
}

// ── PRODUCTION ─────────────────────────────────────────────────────────────────
async function production() {
  let ok = true;

  const snapshot = process.env.UP_ACCESS_APPLICATION_FILE;
  if (snapshot) {
    const guard = await run('bun', ['run', 'release:access:check']);
    if (guard.code === 0) record('production: Access posture guard', 'ok', 'employee-only policy');
    else {
      record(
        'production: Access posture guard',
        'fail',
        guard.out.trim().split('\n').slice(-3).join(' '),
      );
      ok = false;
    }
  } else {
    record('production: Access posture guard', 'blocked', 'set UP_ACCESS_APPLICATION_FILE');
  }

  const token = process.env.CF_ACCESS_TOKEN;
  const approved = process.env.UP_ALLOW_PRODUCTION_DEPLOY === 'yes';
  if (!token || !approved) {
    record(
      'production: live authed deploy',
      'blocked',
      !token
        ? 'needs CF_ACCESS_TOKEN (cloudflared access token -app https://up.coey.dev)'
        : 'needs UP_ALLOW_PRODUCTION_DEPLOY=yes (explicit approval)',
    );
    return { ok, blocked: true };
  }

  const e2e = await run('node', ['scripts/production-e2e.mjs']);
  if (e2e.code === 0) {
    record('production: live authed deploy', 'ok', 'deploy→serve→identity→anonymous-block');
    console.log(e2e.out.trim().split('\n').slice(-12).join('\n'));
  } else {
    record(
      'production: live authed deploy',
      'fail',
      e2e.out.trim().split('\n').slice(-5).join('\n'),
    );
    ok = false;
  }
  return { ok, blocked: false };
}

// ── DRIVER ─────────────────────────────────────────────────────────────────────
const result = { local: null, production: null };

if (!productionOnly) result.local = await local();
if (!localOnly) result.production = await production();

console.log(`\n${'─'.repeat(60)}`);
const localOk = productionOnly || result.local === true;
const prodOk = localOnly || result.production?.ok;
const prodBlocked = !localOnly && result.production?.blocked;

if (!localOk) {
  console.log('RESULT: FAIL (local onboarding broken)');
  process.exit(1);
}
if (!prodOk) {
  console.log('RESULT: FAIL (production verification failed)');
  process.exit(1);
}
if (prodBlocked) {
  console.log('RESULT: LOCAL GREEN · PRODUCTION BLOCKED (needs human-authorized inputs)');
  process.exit(BLOCKED);
}
console.log('RESULT: ALL GREEN (local + production)');
process.exit(0);
