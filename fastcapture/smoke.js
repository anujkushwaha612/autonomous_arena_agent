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

const { spawn, execSync } = require('child_process');
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
const BOOT_TIMEOUT_MS = Number(process.env.SMOKE_BOOT_MS || 120000);
const TEST_TIMEOUT_MS = Number(process.env.SMOKE_TEST_MS || 20000);
const INSTALL_TIMEOUT_MS = Number(process.env.SMOKE_INSTALL_MS || 300000);
// Shared, persistent cache for any embedded-database binary the product uses.
const MONGO_CACHE_DIR = path.join(REPO_ROOT, '.cache', 'mongodb-binaries');

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
    env: {
      ...process.env,
      // Persist the mongodb-memory-server binary OUTSIDE node_modules.
      // It defaults to node_modules/.cache, which is ~212 MB and is wiped every
      // time dependencies are reinstalled — so every round would re-download it.
      MONGOMS_DOWNLOAD_DIR: process.env.MONGOMS_DOWNLOAD_DIR || MONGO_CACHE_DIR,
      // Pin the mongod build. The library's default (6.0.x) has no binary for
      // Debian 12+/13 and dies with KnownVersionIncompatibilityError, which
      // looks like the agent's bug but is purely an environment mismatch.
      MONGOMS_VERSION: process.env.MONGOMS_VERSION || '7.0.14',
      ...loadDotEnv(APP_DIR),
      PORT: String(PORT),
      NODE_ENV: 'test',
    },
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


/**
 * Install the product's dependencies before booting it.
 *
 * The agent installs packages inside ITS sandbox, but node_modules is
 * gitignored — correctly, it must never be committed. So the patch that lands
 * on this machine has package.json and source but no dependencies, and
 * `npm start` dies with MODULE_NOT_FOUND on the first require('express').
 *
 * We install here, once, and only when the lockfile/manifest has changed.
 */

/**
 * Load app/.env into the environment the app is booted with.
 *
 * This is what lets you drop a real MONGODB_URI into app/.env and have the
 * smoke tests exercise your actual database. The file is gitignored, so the
 * credential never reaches an agent or a commit — it exists only on your
 * machine, and only for the duration of the boot.
 *
 * Deliberately a tiny parser: no dependency, and the runner must work before
 * the product has installed anything.
 */
function loadDotEnv(appDir) {
  const envPath = path.join(appDir, '.env');
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  let raw;
  try { raw = fs.readFileSync(envPath, 'utf8'); } catch { return {}; }
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    // A real shell env var always wins over the file.
    if (!(key in process.env)) out[key] = val;
  }
  return out;
}

function ensureDeps(appDir, log) {
  const pkgPath = path.join(appDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return true;

  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch { return true; }
  const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
  if (!deps.length) return true; // stdlib-only project — nothing to do

  // Skip the install if node_modules already satisfies the manifest.
  const stampPath = path.join(appDir, 'node_modules', '.smoke-install-stamp');
  const manifest = ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']
    .map((f) => {
      const abs = path.join(appDir, f);
      return fs.existsSync(abs) ? `${f}:${fs.statSync(abs).mtimeMs}` : '';
    })
    .join('|');

  if (fs.existsSync(stampPath)) {
    try {
      if (fs.readFileSync(stampPath, 'utf8') === manifest) return true;
    } catch {}
  }

  const hasLock = fs.existsSync(path.join(appDir, 'package-lock.json'));
  const cmd = hasLock ? 'npm ci --no-audit --no-fund' : 'npm install --no-audit --no-fund';
  log(`  📦 installing dependencies (${deps.length} package(s))… this may take a minute`);

  try {
    execSync(cmd, {
      cwd: appDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: INSTALL_TIMEOUT_MS,
      env: { ...process.env, CI: 'true' },
    });
  } catch (e) {
    // `npm ci` is strict: it fails if the lockfile is out of sync with
    // package.json. Fall back to a plain install rather than failing the round.
    if (hasLock) {
      log('  ⚠️  npm ci failed — retrying with npm install');
      try {
        execSync('npm install --no-audit --no-fund', {
          cwd: appDir,
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: INSTALL_TIMEOUT_MS,
          env: { ...process.env, CI: 'true' },
        });
      } catch (e2) {
        log(`  ❌ dependency install failed: ${String(e2.stderr || e2.message).split('\n').slice(-6).join(' ')}`);
        return false;
      }
    } else {
      log(`  ❌ dependency install failed: ${String(e.stderr || e.message).split('\n').slice(-6).join(' ')}`);
      return false;
    }
  }

  try {
    fs.mkdirSync(path.join(appDir, 'node_modules'), { recursive: true });
    fs.writeFileSync(stampPath, manifest);
  } catch {}
  log('  ✅ dependencies installed');
  return true;
}

/**
 * Does this project need a TypeScript loader?
 *
 * `npm start` may run through tsx/ts-node, so the SERVER boots fine — but our
 * own test loader is plain node. A test that imports app source then dies with
 * "Cannot find module ./db.js", because TypeScript emits .js specifiers that
 * only a TS loader resolves back to .ts. Detect that and re-exec this runner
 * under whichever loader the project already depends on.
 */
function needsTsLoader(appDir, files) {
  if (process.env.SMOKE_TS_RELOADED) return null; // already re-execed once
  const hasTsTest = files.some((f) => /\.(ts|mts)$/.test(f));
  const hasTsSrc = fs.existsSync(path.join(appDir, 'tsconfig.json'));
  if (!hasTsTest && !hasTsSrc) return null;
  for (const loader of ['tsx', 'ts-node']) {
    if (fs.existsSync(path.join(appDir, 'node_modules', loader))) return loader;
  }
  return null;
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

  const files = fs
    .readdirSync(TEST_DIR)
    .filter((f) => /\.test\.(js|mjs|cjs|ts|mts)$/.test(f))
    .sort();
  if (!files.length) {
    console.log('  ⚠️  no *.test.js files found — skipping.');
    return 0;
  }

  if (!ensureDeps(APP_DIR, (m) => console.log(m))) {
    console.log('  ── smoke: could not install dependencies ──\n');
    return 1;
  }

  const tsLoader = needsTsLoader(APP_DIR, files);
  if (tsLoader) {
    console.log(`  🔁 TypeScript project — re-running tests under ${tsLoader}`);
    const args =
      tsLoader === 'tsx' ? ['--import', 'tsx', __filename] : ['-r', 'ts-node/register', __filename];
    const res = require('child_process').spawnSync(process.execPath, args, {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: {
        ...process.env,
        SMOKE_TS_RELOADED: '1',
        NODE_PATH: path.join(APP_DIR, 'node_modules'),
      },
    });
    return res.status === null ? 1 : res.status;
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
