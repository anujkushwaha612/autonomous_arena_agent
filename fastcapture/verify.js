#!/usr/bin/env node
'use strict';
/**
 * Preflight: proves the out-of-band transport works before you rely on it.
 *
 *   npm run verify                    # local capability + byte-integrity check
 *   npm run verify -- <URL> <TOKEN>   # also upload to a live ingest
 *
 * Exits non-zero on failure so you can gate on it.
 */

const { execSync } = require('child_process');
const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs');
const os = require('os');
const path = require('path');

const [, , URL_ARG, TOKEN_ARG] = process.argv;
let failures = 0;

const ok = (l, d = '') => console.log(`  ✅ ${l}${d ? '  ' + d : ''}`);
const bad = (l, d = '') => { console.log(`  ❌ ${l}${d ? '  ' + d : ''}`); failures++; };
const run = (c) => execSync(c, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

console.log('\n── 1. required tools ─────────────────────────────');
for (const t of ['curl', 'git', 'gzip', 'node']) {
  try { ok(t, run(`command -v ${t}`)); } catch { bad(t, 'NOT FOUND'); }
}

console.log('\n── 2. outbound network ───────────────────────────');
try {
  const code = run('curl -sS -o /dev/null -w "%{http_code}" --max-time 15 https://github.com');
  code === '200' ? ok('HTTPS egress', `github.com → ${code}`) : bad('HTTPS egress', `got ${code}`);
} catch (e) { bad('HTTPS egress', e.message.split('\n')[0]); }

const proxies = Object.keys(process.env).filter((k) => /_proxy$/i.test(k));
proxies.length
  ? console.log(`  ⚠️  proxy vars set: ${proxies.join(', ')} (may rewrite bodies)`)
  : ok('no HTTP proxy interception');

console.log('\n── 3. patch generation ───────────────────────────');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acverify-'));
let gzPath, sentSha;
try {
  const g = (c) => execSync(c, { cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'] });
  g('git init -q .');
  g('git config user.email v@local');
  g('git config user.name verify');
  fs.writeFileSync(path.join(tmp, 'a.txt'), 'hello\n');
  g('git add -A');
  g('git commit -qm init');
  fs.appendFileSync(path.join(tmp, 'a.txt'), 'l2\nl3\n');
  fs.mkdirSync(path.join(tmp, 'app'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'app/s.js'), 'console.log(1)\n');
  g('git add -A');

  const diff = g('git diff --cached --binary');
  const gz = zlib.gzipSync(Buffer.from(diff + '\n'), { level: 9 });
  gzPath = path.join(tmp, 'patch.gz');
  fs.writeFileSync(gzPath, gz);
  sentSha = crypto.createHash('sha256').update(gz).digest('hex');
  ok('git diff --binary | gzip -9', `${diff.length}B → ${gz.length}B`);
  ok('sha256 of payload', sentSha.slice(0, 16) + '…');
} catch (e) { bad('patch generation', e.message.split('\n')[0]); }

console.log('\n── 4. binary POST round-trip ─────────────────────');
if (!URL_ARG) {
  try {
    const out = run(
      `curl -sS --fail --max-time 30 -H "content-type: application/octet-stream" ` +
        `--data-binary @${gzPath} https://httpbin.org/post`
    );
    const back = Buffer.from(JSON.parse(out).data.split('base64,')[1], 'base64');
    const backSha = crypto.createHash('sha256').update(back).digest('hex');
    if (backSha === sentSha) {
      ok('byte-exact echo', `${back.length}B, sha matches`);
      ok('gunzip round-trip', zlib.gunzipSync(back).toString().split('\n')[0]);
    } else {
      bad('byte integrity', `${sentSha.slice(0, 12)} vs ${backSha.slice(0, 12)}`);
    }
  } catch (e) { bad('binary POST', e.message.split('\n')[0]); }
  console.log('\n  ℹ️  Echo-tested only. For a real check:');
  console.log('     npm run verify -- <INGEST_URL> <TOKEN>');
} else {
  try {
    const out = run(
      `curl -sS --fail --retry 2 --max-time 60 -H "x-agent-token: ${TOKEN_ARG}" ` +
        `-H "content-type: application/octet-stream" --data-binary @${gzPath} ` +
        `"${URL_ARG}/patch?kind=patch&round=verify"`
    );
    const j = JSON.parse(out);
    if (j.receipt) {
      ok('ingest accepted', `receipt=${j.receipt} bytes=${j.bytes}`);
      console.log(`\n  → agent would print:  %%%RECEIPT:${j.receipt}%%%`);
    } else {
      bad('ingest response', out.slice(0, 120));
    }
  } catch (e) { bad('upload to ingest', e.message.split('\n')[0]); }
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log('\n──────────────────────────────────────────────────');
if (failures) {
  console.log(`❌ ${failures} check(s) failed.\n`);
  process.exit(1);
}
console.log('✅ All checks passed — transport is usable.\n');
console.log('⚠️  Never validate with webhook.site / RequestBin: they store bodies');
console.log('   as UTF-8 text and corrupt gzip (observed 177B → 175B).\n');
