'use strict';
/**
 * Auto-tunnel: gives the agent sandbox a public HTTPS URL that reaches your
 * local ingest server.
 *
 * WHY THIS IS NEEDED
 * The Arena agent runs on Arena's machines, not yours. When it does
 * `curl http://localhost:8787` that means *its* localhost, not your laptop.
 * Your laptop has no public address (it's behind your router/NAT), so the
 * agent literally cannot reach it. A tunnel gives you a temporary public
 * https URL that forwards to your local port.
 *
 * You do NOT need to install anything: if `cloudflared` isn't on your PATH we
 * download the small binary into ./.bin automatically on first run.
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const BIN_DIR = path.join(__dirname, '..', '.bin');

/** Where we'd put our own copy. */
function localBinPath() {
  return path.join(BIN_DIR, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
}

/** Find cloudflared: system PATH first, then our downloaded copy. */
function findCloudflared() {
  const probe = process.platform === 'win32' ? 'where cloudflared' : 'command -v cloudflared';
  try {
    const p = execSync(probe, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n')[0];
    if (p) return p;
  } catch {}
  const local = localBinPath();
  return fs.existsSync(local) ? local : null;
}

/** Official release asset for this platform. */
function assetUrl() {
  const base = 'https://github.com/cloudflare/cloudflared/releases/latest/download/';
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'arm' ? 'arm' : 'amd64';
  if (process.platform === 'win32') return base + `cloudflared-windows-${arch === 'arm64' ? 'amd64' : arch}.exe`;
  if (process.platform === 'darwin') return base + `cloudflared-darwin-${arch}.tgz`;
  return base + `cloudflared-linux-${arch}`;
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) return reject(new Error('too many redirects'));
    https
      .get(url, { headers: { 'User-Agent': 'agentchain' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(download(res.headers.location, dest, redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} fetching cloudflared`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

/** Extract the single `cloudflared` file out of a .tgz (macOS asset). */
function extractFromTgz(buf, dest) {
  const tar = zlib.gunzipSync(buf);
  // Minimal tar reader: 512-byte headers, name at 0, size (octal) at 124.
  let off = 0;
  while (off + 512 <= tar.length) {
    const name = tar.toString('utf8', off, off + 100).replace(/\0.*$/, '');
    const sizeStr = tar.toString('utf8', off + 124, off + 136).replace(/\0.*$/, '').trim();
    if (!name) break;
    const size = parseInt(sizeStr, 8) || 0;
    const start = off + 512;
    if (path.basename(name) === 'cloudflared' && size > 0) {
      fs.writeFileSync(dest, tar.subarray(start, start + size));
      return true;
    }
    off = start + Math.ceil(size / 512) * 512;
  }
  return false;
}

async function ensureCloudflared(log = console.log) {
  const found = findCloudflared();
  if (found) return found;

  const dest = localBinPath();
  const url = assetUrl();
  log('  ⬇️  cloudflared not found — downloading it once (~35 MB)…');
  log(`     ${url}`);
  fs.mkdirSync(BIN_DIR, { recursive: true });

  const buf = await download(url, dest);
  if (url.endsWith('.tgz')) {
    if (!extractFromTgz(buf, dest)) throw new Error('could not extract cloudflared from archive');
  } else {
    fs.writeFileSync(dest, buf);
  }
  if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
  log(`  ✅ saved to ${dest}`);
  return dest;
}

/** Start a quick tunnel (no Cloudflare account needed) and resolve its URL. */
async function startTunnel(port, { timeoutMs = 60000, log = console.log } = {}) {
  const bin = await ensureCloudflared(log);

  return new Promise((resolve, reject) => {
    const proc = spawn(bin, ['tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let settled = false;
    let buf = '';
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };

    const timer = setTimeout(() => {
      proc.kill();
      done(reject, new Error('timed out waiting for cloudflared to report a URL'));
    }, timeoutMs);

    const scan = (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) done(resolve, { url: m[0], proc });
    };

    proc.stdout.on('data', scan);
    proc.stderr.on('data', scan); // cloudflared logs the URL to stderr
    proc.on('error', (e) => done(reject, e));
    proc.on('exit', (code) => done(reject, new Error(`cloudflared exited early (code ${code})`)));
  });
}

module.exports = { startTunnel, ensureCloudflared, findCloudflared };
