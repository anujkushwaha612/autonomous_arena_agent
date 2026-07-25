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

/**
 * Resolve a hostname via DNS-over-HTTPS (port 443).
 *
 * Plain DNS to 1.1.1.1/8.8.8.8 uses UDP/53, which many ISPs and corporate
 * networks block or hijack — so a direct Resolver() call can hang forever even
 * though the internet works fine. DoH tunnels the same query over HTTPS and
 * gets through. It also sidesteps the OS negative cache.
 */
function resolveDoH(host, provider = 'cloudflare-dns.com') {
  return new Promise((resolve) => {
    const req = https.get(
      {
        host: provider,
        path: `/dns-query?name=${encodeURIComponent(host)}&type=A`,
        headers: { accept: 'application/dns-json', 'User-Agent': 'agentchain' },
        timeout: 8000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            const a = (j.Answer || []).filter((x) => x.type === 1).map((x) => x.data);
            resolve(a[0] || null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/** Best-effort resolve: DoH first, then the OS resolver. */
async function resolveAny(host) {
  for (const p of ['cloudflare-dns.com', 'dns.google']) {
    const ip = await resolveDoH(host, p);
    if (ip) return ip;
  }
  try {
    const a = await require('dns').promises.lookup(host);
    if (a && a.address) return a.address;
  } catch {}
  return null;
}

/**
 * Wait for the tunnel hostname to become resolvable.
 *
 * IMPORTANT: this is best-effort and NEVER throws. Our machine failing to
 * resolve the name proves nothing about the agent's sandbox, which uses its own
 * DNS. Blocking the whole run on a local DNS quirk was a bug; now we simply
 * warn and continue, and the worker's self-test decides whether things work.
 */
async function waitForDns(host, log = console.log, timeoutMs = 45000) {
  const started = Date.now();
  let announced = false;
  while (Date.now() - started < timeoutMs) {
    const ip = await resolveAny(host);
    if (ip) {
      log(`  ✅ DNS live after ${Math.round((Date.now() - started) / 1000)}s (${ip})`);
      return ip;
    }
    if (!announced && Date.now() - started > 4000) {
      announced = true;
      log('  ⏳ waiting for tunnel DNS to propagate…');
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  log(`  ⚠️  couldn't confirm DNS locally after ${Math.round(timeoutMs / 1000)}s.`);
  log('     Your network may block DNS lookups; the tunnel is probably fine.');
  log('     Continuing — the self-test will confirm.');
  return null;
}

/** Start a quick tunnel (no Cloudflare account needed) and resolve its URL. */
async function startTunnel(port, { timeoutMs = 150000, log = console.log } = {}) {
  const bin = await ensureCloudflared(log);

  return new Promise((resolve, reject) => {
    // Use 127.0.0.1, NOT "localhost". On Windows localhost resolves to ::1
    // first, but the ingest server binds IPv4 loopback — cloudflared would
    // get ECONNREFUSED and every upload would fail as "unreachable".
    const proc = spawn(bin, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let settled = false;
    let resolving = false;
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
      // cloudflared prints the URL before DNS exists. Don't hand it back until
      // the hostname actually resolves publicly, otherwise the very first
      // lookup NXDOMAINs and gets negative-cached for minutes.
      if (m && !resolving) {
        resolving = true;
        waitForDns(new URL(m[0]).hostname, log)
          .catch(() => null) // never fatal
          .then(() => done(resolve, { url: m[0], proc }));
      }
    };

    proc.stdout.on('data', scan);
    proc.stderr.on('data', scan); // cloudflared logs the URL to stderr
    proc.on('error', (e) => done(reject, e));
    proc.on('exit', (code) => done(reject, new Error(`cloudflared exited early (code ${code})`)));
  });
}

module.exports = { startTunnel, ensureCloudflared, findCloudflared, resolveAny, resolveDoH };
