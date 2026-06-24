#!/usr/bin/env node
// Live proof for the homepage headline: `up deploy` puts a real dynamic Worker
// (KV + D1 + Durable Object) on a public URL with no Cloudflare account.
//
// This is the "watched it run" receipt. It deploys examples/binding-lab to a real
// Temporary Account, exercises every binding over the public URL, then leaves the
// account to expire (~1h). It never claims and never prints the claim URL.
//
// Gated: requires UP_RUN_LIVE_ANONYMOUS=yes and UP_ACCEPT_CLOUDFLARE_TERMS=yes
// (terms acceptance is a human decision). Exit: 0 ok · 1 fail · 78 blocked.

import { spawn } from 'node:child_process';

const BLOCKED = 78;
const APP = 'examples/binding-lab';

// Strip account-wide ownership links from anything we print.
const redact = (text) =>
  String(text)
    .replace(/https?:\/\/[^\s]*claim[^\s]*/gi, '[claim-url redacted]')
    .replace(/claimToken=[A-Za-z0-9._-]+/gi, 'claimToken=[redacted]');

function sh(command, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
    child.on('error', (e) => resolve({ code: 1, out: String(e) }));
  });
}

// curl -k dodges corporate TLS interception; this is a disposable public app.
async function get(url, init = {}) {
  const args = ['-sk', '-m', '25', '-X', init.method || 'GET'];
  for (const [k, v] of Object.entries(init.headers || {})) args.push('-H', `${k}: ${v}`);
  if (init.body) args.push('--data', init.body);
  args.push('-w', '\n__HTTP__%{http_code}', url);
  const { out } = await sh('curl', args);
  const marker = out.lastIndexOf('\n__HTTP__');
  const status = Number(out.slice(marker + 9).trim());
  const body = out.slice(0, marker);
  return { status, body };
}

if (
  process.env.UP_RUN_LIVE_ANONYMOUS !== 'yes' ||
  process.env.UP_ACCEPT_CLOUDFLARE_TERMS !== 'yes'
) {
  console.log(
    '▷ blocked — set UP_RUN_LIVE_ANONYMOUS=yes and UP_ACCEPT_CLOUDFLARE_TERMS=yes to run a live\n' +
      '  disposable deploy (no account, auto-expires in ~1h). This accepts Cloudflare\u2019s terms.',
  );
  process.exit(BLOCKED);
}

const name = `binding-lab-verify-${Date.now().toString(36)}`;
console.log(`Deploying ${APP} to a real Temporary Account as ${name}\u2026`);

const deploy = await sh(
  'bun',
  ['run', 'cli/up.ts', 'deploy', APP, name, '--accept-cloudflare-terms'],
  {
    env: process.env,
  },
);
console.log(
  redact(deploy.out)
    .split('\n')
    .filter((l) => !/^Keep it|^This link claims|sensitive ownership/.test(l))
    .join('\n'),
);
if (deploy.code !== 0) {
  console.log('\nRESULT: FAIL (deploy failed)');
  process.exit(1);
}

const liveUrl = (redact(deploy.out).match(/https:\/\/[^\s]+workers\.dev[^\s]*/) || [])[0];
if (!liveUrl) {
  console.log('\nRESULT: FAIL (no workers.dev URL in output)');
  process.exit(1);
}
const origin = new URL(liveUrl).origin;

const checks = [];
const check = (name, ok, detail) => {
  checks.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const page = await get(`${origin}/`);
check('public page serves (Static Assets)', page.status === 200, `HTTP ${page.status}`);

const before = await get(`${origin}/api/state`);
let s1 = {};
try {
  s1 = JSON.parse(before.body);
} catch {}
check(
  'KV read/write (pageViews)',
  before.status === 200 && Number.isFinite(s1.pageViews) && s1.pageViews >= 1,
  `pageViews=${s1.pageViews}`,
);
check(
  'Durable Object (roomVisits)',
  Number.isFinite(s1.roomVisits) && s1.roomVisits >= 1,
  `roomVisits=${s1.roomVisits}`,
);
check(
  'D1 (notes table)',
  Array.isArray(s1.notes),
  `notes=${Array.isArray(s1.notes) ? s1.notes.length : 'n/a'}`,
);

const note = `verify ${new Date().toISOString()}`;
const post = await get(`${origin}/api/notes`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ body: note }),
});
const after = await get(`${origin}/api/state`);
let s2 = {};
try {
  s2 = JSON.parse(after.body);
} catch {}
check(
  'D1 write persists',
  post.status === 201 && (s2.notes || []).some((n) => n.body === note),
  `wrote "${note.slice(0, 16)}…"`,
);
check(
  'KV increments across requests',
  Number(s2.pageViews) > Number(s1.pageViews),
  `${s1.pageViews} → ${s2.pageViews}`,
);

console.log(`\nLeft to expire — not claimed. Public URL: ${origin}`);
console.log(`${'─'.repeat(60)}`);
if (checks.every(Boolean)) {
  console.log('RESULT: ALL GREEN — real Worker + KV + D1 + Durable Object, no account.');
  process.exit(0);
}
console.log('RESULT: FAIL (a binding did not behave)');
process.exit(1);
