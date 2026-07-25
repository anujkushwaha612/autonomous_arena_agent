#!/usr/bin/env node
'use strict';
/**
 * AgentChain worker.
 *
 * One command: `node worker.js`
 *   1. boots the ingest server in-process
 *   2. opens a public tunnel so the agent sandbox can reach it
 *   3. drives Arena in a browser, one task per round
 *   4. waits for a 12-char receipt, applies the byte-exact patch, pushes
 *
 * The patch never travels through chat, so there is no base64, no markdown
 * corruption, no truncation, and no settle-wait.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error(`
❌ Playwright is not installed.

   npm install
   npx playwright install chromium
`);
  process.exit(1);
}

const CONFIG = require('./config');
const { startIngest } = require('./fastcapture/ingest-server');
const { startTunnel } = require('./fastcapture/tunnel');
const { findReceipt, applyDrop } = require('./fastcapture/claim');

// ── shell helpers ────────────────────────────────────────────────────────────
const sh = (cmd) =>
  execSync(cmd, { cwd: CONFIG.repoRoot, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const shQuiet = (cmd) => {
  try {
    return sh(cmd);
  } catch {
    return '';
  }
};

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  AgentChain worker                       ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  repo: ${CONFIG.repoRoot}`);

  preflight();

  // 1. ingest server (in-process — no second terminal needed)
  console.log('\n▸ Starting ingest…');
  const ingest = await startIngest({
    port: CONFIG.ingestPort,
    token: CONFIG.ingestToken,
    dropDir: CONFIG.dropDir,
  });

  // 2. public URL for the agent sandbox
  let ingestUrl = CONFIG.ingestUrl;
  let tunnelProc = null;
  if (!ingestUrl && CONFIG.tunnel) {
    console.log('\n▸ Opening tunnel (so the agent can reach your machine)…');
    const t = await startTunnel(CONFIG.ingestPort);
    ingestUrl = t.url;
    tunnelProc = t.proc;
    console.log(`  ✅ public URL: ${ingestUrl}`);
  } else if (!ingestUrl) {
    ingestUrl = `http://localhost:${CONFIG.ingestPort}`;
    console.log(`  ⚠️  TUNNEL=off and no INGEST_URL — using ${ingestUrl}`);
    console.log('     The agent sandbox must be able to reach that address.');
  } else {
    console.log(`\n▸ Using INGEST_URL: ${ingestUrl}`);
  }

  const cleanup = () => {
    try { ingest.close(); } catch {}
    if (tunnelProc) { try { tunnelProc.kill(); } catch {} }
  };
  process.on('SIGINT', () => { console.log('\nInterrupted.'); cleanup(); process.exit(130); });

  // 2b. Prove the URL works from the OUTSIDE before spending a whole round on
  // it. Without this, a broken tunnel only surfaces as "upload endpoint is
  // unreachable" two minutes later, with no clue why.
  console.log('\n▸ Self-testing the public URL (new tunnels need ~15s to propagate)…');
  const reachable = await selfTest(ingestUrl, {
    onProgress: (m) => console.log(`     …${m}`),
  });
  if (!reachable.ok) {
    console.error(`
  ❌ Your ingest URL is NOT reachable from the internet.
     URL:   ${ingestUrl}
     Error: ${reachable.error}  (gave up after ${Math.round((reachable.ms || 0) / 1000)}s)

     The agent would fail with "upload endpoint unreachable", so stopping now.

     Things to try:
       • Re-run — trycloudflare quick tunnels are occasionally flaky.
       • Check a firewall/VPN isn't blocking cloudflared.
       • Supply your own URL:  INGEST_URL=https://... TUNNEL=off node worker.js
`);
    cleanup();
    process.exit(1);
  }
  console.log(`  ✅ reachable from the internet (${reachable.ms}ms round trip)`);

  // 3. round loop
  try {
    for (let round = 1; round <= CONFIG.maxRounds; round++) {
      console.log(`\n═══════════════ ROUND ${round} ═══════════════`);

      shQuiet('git pull --ff-only');

      const remaining = countTodo();
      if (remaining === 0) {
        console.log('  🎉 No TODO tasks left in agents.md. Project complete!');
        break;
      }
      console.log(`  ${remaining} task(s) remaining`);

      const nonce = String(Date.now());
      const prompt = buildPrompt({ round, nonce, ingestUrl });
      const anchor = `###WORKER_ANCHOR_${nonce}###`;

      const context = await chromium.launchPersistentContext(CONFIG.browserProfileDir, {
        headless: CONFIG.headless,
        viewport: { width: 1366, height: 900 },
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-infobars',
        ],
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      });
      const page = context.pages()[0] || (await context.newPage());

      let result;
      try {
        await page.goto(CONFIG.newChatUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await ensureLoggedIn(page);
        await tryNewChat(page);
        await typePrompt(page, prompt);
        await submit(page);
        console.log('  ⏳ Waiting for agent…');
        result = await waitForResult(page, anchor);
      } finally {
        await context.close();
      }

      if (result.kind === 'failed') {
        console.log(`\n  ❌ Agent reported failure: ${result.reason}`);
        break;
      }
      if (result.kind === 'timeout') {
        console.log('\n  ⏰ Timed out waiting for the agent. Stopping for review.');
        break;
      }
      if (result.kind === 'done') {
        if (countTodo() > 0) {
          console.log('  ⚠️  Agent said ALL_DONE but TODOs remain — retrying.');
          continue;
        }
        console.log('\n  🎉 All tasks complete!');
        break;
      }

      // receipt
      console.log(`  🎫 Receipt: ${result.receipt}`);
      try {
        const r = applyDrop({
          repoRoot: CONFIG.repoRoot,
          dropDir: CONFIG.dropDir,
          receipt: result.receipt,
          round,
        });
        if (r.mode === 'skipped') {
          console.log(`  ↪️  Already applied (${r.note}).`);
        } else {
          console.log(`  ✅ Applied ${r.bytes}B via ${r.mode}, committed & pushed.`);
        }
      } catch (e) {
        console.error(`\n  ❌ Could not apply drop: ${e.message}`);
        break;
      }
    }
  } catch (err) {
    console.error('\n  ❌ Worker error:', err.message);
  } finally {
    cleanup();
  }

  console.log('\nWorker finished.\n');
  process.exit(0);
}

/**
 * Hit /health over the public URL, the same way the agent will.
 * Retries briefly: a fresh quick tunnel can take a few seconds to propagate.
 */
/**
 * Hit /health over the public URL, exactly as the agent will.
 *
 * A brand-new trycloudflare hostname is NOT immediately usable: DNS needs
 * ~5-10s to propagate and the edge another few seconds to route. Measured on a
 * real tunnel: DNS resolved at +8.7s, first HTTP 200 at +15.2s. So we poll
 * against a generous deadline instead of failing on the first ENOTFOUND.
 */
function selfTest(baseUrl, { timeoutMs = 120000, onProgress = () => {} } = {}) {
  const mod = baseUrl.startsWith('https') ? require('https') : require('http');
  const dns = require('dns');
  const { Resolver } = dns.promises;
  const started = Date.now();
  const host = new URL(baseUrl).hostname;

  /**
   * Resolve via public DNS, bypassing the OS resolver.
   *
   * Why: cloudflared prints the tunnel URL *before* the hostname exists in DNS.
   * Our first lookup therefore gets NXDOMAIN, and the OS (and some upstream
   * resolvers) cache that negative answer for minutes. The name then appears
   * publicly but our machine keeps saying ENOTFOUND long after the tunnel is
   * live. Observed exactly this: 1.1.1.1 answered while the system resolver
   * and 8.8.8.8 still returned ENOTFOUND.
   *
   * So we ask authoritative-ish public resolvers directly and connect by IP.
   */
  async function resolvePublic() {
    for (const servers of [['1.1.1.1', '1.0.0.1'], ['8.8.8.8', '8.8.4.4'], null]) {
      try {
        if (servers) {
          const r = new Resolver();
          r.setServers(servers);
          const a = await r.resolve4(host);
          if (a && a.length) return a[0];
        } else {
          const a = await dns.promises.lookup(host);
          if (a && a.address) return a.address;
        }
      } catch {}
    }
    return null;
  }

  const probe = (ip) =>
    new Promise((resolve) => {
      const opts = {
        host: ip || host,
        servername: host, // correct SNI when connecting by IP
        headers: { Host: host, 'User-Agent': 'agentchain-selftest' },
        path: '/health',
        port: baseUrl.startsWith('https') ? 443 : 80,
        timeout: 10000,
      };
      const req = mod.get(opts, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString();
          if (res.statusCode === 200 && body.includes('"ok"')) resolve({ ok: true });
          else resolve({ ok: false, error: `HTTP ${res.statusCode}: ${body.slice(0, 100)}` });
        });
      });
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timed out' }); });
      req.on('error', (e) => resolve({ ok: false, error: e.code || e.message }));
    });

  return (async () => {
    let last = { ok: false, error: 'no attempt made' };
    let n = 0;
    while (Date.now() - started < timeoutMs) {
      const ip = await resolvePublic();
      if (ip) {
        last = await probe(ip);
        if (last.ok) return { ok: true, ms: Date.now() - started, ip };
      } else {
        last = { ok: false, error: 'ENOTFOUND (DNS still propagating)' };
      }
      n++;
      if (n === 3 || n % 8 === 0) {
        onProgress(`${last.error} — retrying (${Math.round((Date.now() - started) / 1000)}s)`);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return { ...last, ms: Date.now() - started };
  })();
}

// ── setup checks ─────────────────────────────────────────────────────────────
function preflight() {
  if (!fs.existsSync(path.join(CONFIG.repoRoot, '.git'))) {
    console.error(`
❌ ${CONFIG.repoRoot} is not a git repository.

   git init && git remote add origin ${CONFIG.repoUrl}
   git add -A && git commit -m "init" && git push -u origin main
`);
    process.exit(1);
  }
  if (!fs.existsSync(CONFIG.brainFile)) {
    console.error(`❌ Missing agents.md at ${CONFIG.brainFile}`);
    process.exit(1);
  }
  if (!fs.existsSync(CONFIG.promptFile)) {
    console.error(`❌ Missing AGENT_PROMPT.md at ${CONFIG.promptFile}`);
    process.exit(1);
  }
}

/**
 * Count real task statuses only — a line that is exactly the bolded status
 * marker. Prose mentioning "STATUS: TODO" in docs must not inflate the count.
 */
function countTodo() {
  const txt = fs.readFileSync(CONFIG.brainFile, 'utf8');
  const m = txt.match(/^\*\*STATUS:\s*TODO\*\*\s*$/gim);
  return m ? m.length : 0;
}

function buildPrompt({ round, nonce, ingestUrl }) {
  return fs
    .readFileSync(CONFIG.promptFile, 'utf8')
    .split('<<<REPO_URL>>>').join(CONFIG.repoUrl)
    .split('<<<INGEST_URL>>>').join(ingestUrl)
    .split('<<<INGEST_TOKEN>>>').join(CONFIG.ingestToken)
    .split('<<<ROUND>>>').join(String(round))
    .split('<<<NONCE>>>').join(nonce);
}

// ── browser helpers ──────────────────────────────────────────────────────────
async function findComposer(page) {
  const visible = page.locator(CONFIG.inputSelectors.join(', ')).filter({ visible: true });
  const n = await visible.count().catch(() => 0);
  return n === 0 ? null : visible.last();
}

async function ensureLoggedIn(page) {
  if ((await findComposer(page)) !== null) return;
  console.log('\n  👉 Please LOG IN to Arena in the browser window. Waiting…');
  while ((await findComposer(page)) === null) {
    await page.waitForTimeout(2000);
  }
  console.log('  ✅ Logged in.');
}

async function tryNewChat(page) {
  for (const sel of CONFIG.newChatSelectors) {
    const btn = page.locator(sel).first();
    if ((await btn.count().catch(() => 0)) > 0) {
      await btn.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(800);
      return;
    }
  }
}

async function typePrompt(page, text) {
  let input = await findComposer(page);
  if (!input) {
    await page
      .locator(CONFIG.inputSelectors.join(', '))
      .filter({ visible: true })
      .first()
      .waitFor({ state: 'visible', timeout: 15000 });
    input = await findComposer(page);
  }

  await input.focus();
  await input.click({ delay: 100 });

  try {
    await input.fill(text);
    await page.waitForTimeout(400);
    if (await entered(page, text)) return;
  } catch {}

  await input.click();
  await input.focus();
  await page.keyboard.insertText(text);
  await page.waitForTimeout(400);
}

async function entered(page, text) {
  const tail = text.slice(-40);
  return page.evaluate((t) => (document.body.innerText || '').includes(t), tail);
}

async function submit(page) {
  for (const sel of CONFIG.sendSelectors) {
    const btn = page.locator(sel).filter({ visible: true }).last();
    if ((await btn.count().catch(() => 0)) > 0) {
      await btn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
      return;
    }
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
}

// ── result detection ─────────────────────────────────────────────────────────
/**
 * No settle-wait. A partially streamed receipt cannot match the 12-hex regex,
 * so there is no "looks complete but isn't" state to guard against.
 */
async function waitForResult(page, anchor) {
  const deadline = Date.now() + CONFIG.maxTaskMs;
  let tick = 0;

  while (Date.now() < deadline) {
    const body = await page.evaluate(() => document.body.innerText || '').catch(() => '');
    const at = body.lastIndexOf(anchor);
    const fresh = at >= 0 ? body.slice(at + anchor.length) : body;

    const receipt = findReceipt(fresh, CONFIG.receiptRegex);
    if (receipt) return { kind: 'receipt', receipt };

    if (fresh.includes(CONFIG.sentinelFailed)) {
      const line = fresh.split('\n').find((l) => l.includes('HANDOFF_FAILED')) || '';
      return { kind: 'failed', reason: line.replace(/%%%HANDOFF_FAILED%%%/g, '').trim() };
    }
    if (fresh.includes(CONFIG.sentinelDone)) return { kind: 'done' };

    if (++tick % 15 === 0) {
      const mins = Math.round((Date.now() - (deadline - CONFIG.maxTaskMs)) / 60000);
      console.log(`     …still working (${mins}m)`);
    }
    await page.waitForTimeout(CONFIG.pollIntervalMs);
  }
  return { kind: 'timeout' };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
