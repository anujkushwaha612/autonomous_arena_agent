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
  } catch { }
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
    // family:4 — many campus/enterprise networks have no working IPv6 route,
    // so an AAAA answer would connect-timeout even though the name resolves.
    const a = await require('dns').promises.lookup(host, { family: 4 });
    if (a && a.address) return a.address;
  } catch { }
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

/**
 * Launch cloudflared once with a specific transport and resolve its public URL.
 *
 * `protocol`:
 *   'quic'  — the default. Uses UDP/7844 outbound.
 *   'http2' — falls back to TCP/443, which almost every network permits.
 *
 * WHY THIS MATTERS
 * Campus and corporate LANs (IIT Bombay's among them) commonly block outbound
 * UDP except DNS. cloudflared then starts happily and prints a URL, but never
 * registers with Cloudflare's edge — so every request returns HTTP 530
 * "error code: 1033". The process looks healthy; the tunnel is dead.
 * Forcing `--protocol http2` puts the control connection on TCP/443.
 */
function launchTunnel(bin, port, protocol, { timeoutMs, log }) {
  return new Promise((resolve, reject) => {
    const args = [
      'tunnel',
      '--url', `http://127.0.0.1:${port}`,
      '--no-autoupdate',
      '--protocol', protocol,
      // Keep edge logs quiet but still emit the URL line we parse.
      '--loglevel', 'info',
    ];
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

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
      try { proc.kill(); } catch { }
      done(reject, new Error(`cloudflared (${protocol}) timed out before reporting a URL`));
    }, timeoutMs);

    const scan = (chunk) => {
      buf += chunk.toString();

      // Surface the classic UDP-blocked signature early instead of waiting out
      // the full timeout.
      if (/failed to dial to edge|failed to create quic connection|no such host.*argotunnel/i.test(buf)) {
        try { proc.kill(); } catch { }
        return done(reject, new Error(`cloudflared (${protocol}) could not reach Cloudflare's edge`));
      }

      const m = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
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
    proc.on('exit', (code) =>
      done(reject, new Error(`cloudflared (${protocol}) exited early (code ${code})`))
    );
  });
}

/**
 * Is the tunnel actually serving? A URL alone proves nothing — with UDP blocked
 * cloudflared prints one and then 530s forever. Hit /health through the public
 * URL and require a real answer.
 */
function tunnelServes(url, { attempts = 8, log = () => { } } = {}) {
  const https = require('https');
  const host = new URL(url).hostname;

  const once = (ip) =>
    new Promise((resolve) => {
      // Connect by IP with explicit SNI + Host. Using the hostname directly
      // would go through the OS resolver, which has just cached NXDOMAIN for
      // this brand-new name — reporting ENOTFOUND even though DNS is live.
      // (waitForDns already proved the name resolves via DoH.)
      const req = https.get(
        {
          host: ip || host,
          servername: host,
          headers: { Host: host, 'User-Agent': 'agentchain-tunnelcheck' },
          path: '/health',
          port: 443,
          timeout: 10000,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString();
            if (res.statusCode === 200 && body.includes('"ok"')) return resolve({ ok: true });
            // 530 / 1033 == edge has no origin connection registered.
            resolve({
              ok: false,
              error: `HTTP ${res.statusCode}${/1033/.test(body) ? ' (error 1033)' : ''}`,
            });
          });
        }
      );
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      req.on('error', (e) => resolve({ ok: false, error: e.code || e.message }));
    });

  return (async () => {
    let last = { ok: false, error: 'not attempted' };
    for (let i = 0; i < attempts; i++) {
      const ip = await resolveAny(host).catch(() => null);
      last = await once(ip);
      if (last.ok) return last;
      await new Promise((r) => setTimeout(r, 2500));
    }
    return last;
  })();
}

/**
 * Start a quick tunnel, trying each transport until one actually serves.
 *
 * Set TUNNEL_PROTOCOL=http2 to skip straight to the TCP path on a network you
 * already know blocks UDP.
 */
async function startTunnel(port, { timeoutMs = 150000, log = console.log } = {}) {
  const bin = await ensureCloudflared(log);

  const forced = process.env.TUNNEL_PROTOCOL;
  const order = forced ? [forced] : ['quic', 'http2'];

  let lastErr = null;

  for (const protocol of order) {
    let started = null;
    try {
      if (order.length > 1 && protocol !== order[0]) {
        log(`  🔁 retrying over ${protocol} (TCP 443) — your network likely blocks UDP…`);
      }
      started = await launchTunnel(bin, port, protocol, { timeoutMs, log });
    } catch (e) {
      lastErr = e;
      continue;
    }

    // A URL is not proof. Confirm the edge can actually reach us.
    const serving = await tunnelServes(started.url, { log });
    if (serving.ok) {
      if (protocol !== 'quic') log(`  ✅ tunnel up over ${protocol}`);
      return started;
    }

    log(`  ⚠️  tunnel over ${protocol} is not serving (${serving.error}).`);
    try { started.proc.kill(); } catch { }
    lastErr = new Error(`tunnel over ${protocol} did not serve traffic (${serving.error})`);
  }

  const help = `
  Could not establish a working tunnel: ${lastErr ? lastErr.message : 'unknown error'}

  This is almost always a restrictive network (campus / corporate / VPN).
  Options, easiest first:

    1. Tether to your phone's cellular data — known to work for you.
    2. Force the TCP transport explicitly:
         TUNNEL_PROTOCOL=http2 node worker.js
    3. Use a different tunnel provider you can reach, e.g.
         npx localtunnel --port 8787
         INGEST_URL=https://<subdomain>.loca.lt TUNNEL=off node worker.js
    4. Run the worker on a machine with a public IP (VPS) and skip tunnelling:
         INGEST_URL=http://<public-ip>:8787 TUNNEL=off node worker.js
`;
  throw new Error(help);
}

module.exports = { startTunnel, ensureCloudflared, findCloudflared, resolveAny, resolveDoH };
