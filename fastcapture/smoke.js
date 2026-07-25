#!/usr/bin/env node
'use strict';
/**
 * Runtime smoke-test runner.
 *
 * Syntax checks cannot catch integration bugs. The only way to know a feature
 * works is to BOOT THE APP AND USE IT. This runner:
 *   1. starts the app (npm start in app/)
 *   2. waits for its port to accept connections
 *   3. runs every app/tests/*.test.js against the live server
 *   4. always tears the server down, even on failure
 *
 * Exit 0 = all passed, 1 = something failed.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const WORK_DIR = process.env.WORK_DIR || 'app';
const APP_DIR = process.env.APP_DIR || path.join(REPO_ROOT, WORK_DIR);
// Command that boots a long-running service. Empty string = nothing to boot,
// so tests run directly (libraries, data pipelines, ML notebooks, docs).
const SMOKE_CMD = process.env.SMOKE_CMD ?? 'npm start';
const TEST_DIR = process.env.TEST_DIR || path.join(APP_DIR, 'tests');
const PORT = Number(process.env.SMOKE_PORT || 3000);
const BOOT_TIMEOUT_MS = Number(process.env.SMOKE_BOOT_MS || 30000);
const TEST_TIMEOUT_MS = Number(process.env.SMOKE_TEST_MS || 20000);

function makeContext() {
  const http = require('http');

  function request(method, urlPath, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : JSON.stringify(body);
      const req = http.request(
        {
          host: '127.0.0.1',
          port: PORT,
          path: urlPath,
          method,
          headers: {
            ...(data
              ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
              : {}),
            ...headers,
          },
          timeout: 10000,
        },
        (res) => {
          let text = '';
          res.on('data', (c) => (text += c));
          res.on('end', () => {
            let json = null;
            try { json = JSON.parse(text); } catch {}
            resolve({ status: res.statusCode, headers: res.headers, json, text });
          });
        }
      );
      req.on('timeout', () => { req.destroy(); reject(new Error(`${method} ${urlPath} timed out`)); });
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }

  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };
  assert.equal = (a, b, msg) => {
    if (a !== b) throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  };
  assert.ok = assert;
  assert.truthy = (v, msg) => {
    if (!v) throw new Error(msg || `expected a truthy value, got ${JSON.stringify(v)}`);
  };

  return {
    PORT,
    APP_DIR,
    baseUrl: `http://127.0.0.1:${PORT}`,
    wsUrl: `ws://127.0.0.1:${PORT}`,
    get: (p, h) => request('GET', p, undefined, h),
    post: (p, b, h) => request('POST', p, b, h),
    put: (p, b, h) => request('PUT', p, b, h),
    del: (p, b, h) => request('DELETE', p, b, h),
    request,
    assert,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    appRequire: (name) => require(require.resolve(name, { paths: [APP_DIR] })),
  };
}

function portOpen(port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const finish = (ok) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, '127.0.0.1');
  });
}

async function waitForPort(port, timeoutMs, child, logTail) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(
        `server exited early (code ${child.exitCode}) before opening port ${port}.\n` +
          `      ---- server output ----\n      ${logTail().split('\n').slice(-15).join('\n      ')}`
      );
    }
    if (await portOpen(port)) return Date.now() - start;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(
    `server never opened port ${port} within ${timeoutMs / 1000}s.\n` +
      `      ---- server output ----\n      ${logTail().split('\n').slice(-15).join('\n      ')}`
  );
}

function startServer() {
  // Run through a shell so SMOKE_CMD can be anything:
  //   "npm start" | "python -m uvicorn main:app" | "go run ." | "cargo run"
  const child = spawn(SMOKE_CMD, {
    cwd: APP_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' },
    shell: true,
  });
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (out += c));
  return { child, logTail: () => out };
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
      } else {
        child.kill('SIGTERM');
      }
    } catch { return resolve(); }
    setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(); }, 4000);
  });
}

async function main() {
  if (!fs.existsSync(APP_DIR)) {
    console.log(`  ⏭  no ${WORK_DIR}/ directory yet — nothing to smoke test.`);
    return 0;
  }
  if (!fs.existsSync(TEST_DIR)) {
    console.log(`  ⚠️  no tests/ directory — add ${WORK_DIR}/tests/*.test.js to verify at runtime.`);
    return 0;
  }

  const files = fs.readdirSync(TEST_DIR).filter((f) => f.endsWith('.test.js')).sort();
  if (!files.length) {
    console.log('  ⚠️  no *.test.js files found — skipping.');
    return 0;
  }

  const needsServer = Boolean(SMOKE_CMD && SMOKE_CMD.trim());
  console.log(
    `\n  🔥 smoke: ${needsServer ? 'booting app and ' : ''}running ${files.length} test file(s)…`
  );

  let child = null;
  let logTail = () => '';
  let failed = 0;
  let passed = 0;

  try {
    if (needsServer) {
      ({ child, logTail } = startServer());
      const ms = await waitForPort(PORT, BOOT_TIMEOUT_MS, child, logTail);
      console.log(`  ✅ server up on :${PORT} (${ms}ms)`);
    }

    for (const file of files) {
      const full = path.join(TEST_DIR, file);
      let mod;
      try {
        // Try CommonJS first, then fall back to ESM. A project with
        // "type": "module" (or a .mjs test) cannot be require()d — assuming
        // CommonJS made the runner reject perfectly good agent code.
        try {
          delete require.cache[require.resolve(full)];
          mod = require(full);
        } catch (cjsErr) {
          if (
            cjsErr.code === 'ERR_REQUIRE_ESM' ||
            cjsErr.code === 'ERR_REQUIRE_ASYNC_MODULE' ||
            /Cannot use import statement|require\(\) of ES Module/i.test(cjsErr.message)
          ) {
            const url = require('url').pathToFileURL(full).href + `?t=${Date.now()}`;
            mod = await import(url);
          } else {
            throw cjsErr;
          }
        }
      } catch (e) {
        console.log(`  ❌ ${file}: could not load — ${e.message.split('\n')[0]}`);
        failed++;
        continue;
      }

      // Accept: module.exports = fn | exports.run = fn | export default fn
      const fn =
        typeof mod === 'function'
          ? mod
          : (mod && (mod.run || mod.default || (mod.default && mod.default.run))) || null;
      if (typeof fn !== 'function') {
        console.log(
          `  ❌ ${file}: must export a function — ` +
            `\`module.exports = async (t) => {…}\` or \`export default async (t) => {…}\``
        );
        failed++;
        continue;
      }

      try {
        await Promise.race([
          fn(makeContext()),
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error(`timed out after ${TEST_TIMEOUT_MS / 1000}s`)), TEST_TIMEOUT_MS)
          ),
        ]);
        console.log(`  ✅ ${file}`);
        passed++;
      } catch (e) {
        console.log(`  ❌ ${file}: ${e.message}`);
        failed++;
      }
    }
  } catch (e) {
    console.log(`  ❌ ${e.message}`);
    failed++;
  } finally {
    await stopServer(child);
  }

  console.log(`  ── smoke: ${passed} passed, ${failed} failed ──\n`);
  return failed === 0 ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((e) => {
    console.error('  ❌ smoke runner crashed:', e.message);
    process.exit(1);
  });
}

module.exports = { main };
