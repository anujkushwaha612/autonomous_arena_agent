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

/**
 * Append one JSON line per event to run.log.jsonl.
 * Unattended runs are impossible to debug from scrollback alone; this survives
 * the terminal closing and makes failures greppable.
 */
function logEvent(event) {
  try {
    fs.appendFileSync(
      CONFIG.runLogFile,
      JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n'
    );
  } catch {}
}
const { startIngest } = require('./fastcapture/ingest-server');
const { startTunnel, resolveAny } = require('./fastcapture/tunnel');
const { findReceipt, applyDrop } = require('./fastcapture/claim');
const { runGate } = require('./fastcapture/gate');

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
  // Ctrl+C: finish the round in flight if possible, then stop. Progress is
  // committed per-round, so nothing is ever lost mid-session.
  let stopRequested = false;
  process.on('SIGINT', () => {
    if (stopRequested) { console.log('\n  Forced exit.'); cleanup(); process.exit(130); }
    stopRequested = true;
    console.log('\n  ⏹  Stop requested — finishing the current task, then exiting.');
    console.log('     (press Ctrl+C again to quit immediately)');
  });
  global.__shouldStop = () => stopRequested;

  // 2b. Best-effort check that the URL is reachable, so an obviously broken
  // tunnel surfaces here instead of as a mysterious failure two minutes later.
  //
  // WARNING/NOT-FATAL by design: a failure here often means YOUR network blocks
  // something (DNS, the trycloudflare domain), not that the tunnel is down. The
  // agent's sandbox uses completely different DNS and routing, so it may well
  // succeed where we failed. Stopping the run on that would be wrong.
  console.log('\n▸ Self-testing the public URL (new tunnels take ~15s to propagate)…');
  const reachable = await selfTest(ingestUrl, {
    onProgress: (m) => console.log(`     …${m}`),
  });
  if (reachable.ok) {
    console.log(`  ✅ reachable from the internet (${reachable.ms}ms round trip)`);
  } else {
    console.log(`
  ⚠️  Could NOT confirm the URL from this machine.
     URL:   ${ingestUrl}
     Error: ${reachable.error} (after ${Math.round((reachable.ms || 0) / 1000)}s)

     This is often a LOCAL network restriction (blocked DNS, filtered domain),
     not a broken tunnel — the agent's sandbox uses different DNS and may be
     able to reach it fine.

     ▸ Continuing anyway. If the agent reports "upload endpoint unreachable":
         • re-run (quick tunnels are occasionally flaky)
         • disable any VPN/proxy, or try a different network
         • or use your own endpoint:  INGEST_URL=https://... TUNNEL=off node worker.js
`);
  }

  // 3. round loop
  const budget = CONFIG.tasksPerSession;
  const totalAtStart = countTodo();
  let completedThisSession = 0;
  let consecutiveFailures = 0;

  if (Number.isFinite(budget)) {
    console.log(
      `\n▸ Session budget: ${budget} task(s) this sitting ` +
        `(${totalAtStart} unfinished overall).`
    );
  }

  try {
    for (let round = 1; round <= CONFIG.maxRounds; round++) {
      console.log(`\n═══════════════ ROUND ${round} ═══════════════`);

      shQuiet('git pull --ff-only');

      // Make sure the remote really has our last commit before the next agent
      // clones. A fixed sleep is a guess; this checks the actual state.
      if (round > 1) waitForRemoteSync();

      const remaining = countTodo();
      if (remaining === 0) {
        console.log('  🎉 No TODO tasks left in agents.md. Project complete!');
        break;
      }
      console.log(
        `  ${remaining} task(s) remaining` +
          (Number.isFinite(budget) ? `  •  ${completedThisSession}/${budget} done this session` : '')
      );

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

      if (result.kind === 'failed' || result.kind === 'timeout') {
        const what =
          result.kind === 'failed'
            ? `Agent reported failure: ${result.reason}`
            : 'Timed out waiting for the agent.';
        consecutiveFailures++;
        logEvent({ event: 'round_failed', round, kind: result.kind, reason: result.reason || null });
        console.log(`\n  ❌ ${what}`);
        if (consecutiveFailures >= CONFIG.maxConsecutiveFailures) {
          console.log(
            `     ${consecutiveFailures} failed rounds in a row — stopping for review.`
          );
          break;
        }
        // Transient problems (a flaky tunnel, a confused agent, a hung page)
        // shouldn't end an unattended run. Nothing was committed, so retrying
        // the same task is safe.
        console.log(
          `     Retrying (${consecutiveFailures}/${CONFIG.maxConsecutiveFailures} consecutive failures).`
        );
        continue;
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
          gate: CONFIG.gateEnabled
            ? (repoRoot, baseline) =>
                runGate(repoRoot, {
                  smoke: CONFIG.smokeEnabled,
                  baseline,
                  userCmd: CONFIG.verifyCmd,
                  timeoutMs: CONFIG.verifyTimeoutMs,
                  log: (m) => console.log(m),
                })
            : null,
        });
        if (r.mode === 'skipped') {
          console.log(`  ↪️  Already applied (${r.note}).`);
        } else {
          console.log(`  ✅ Applied ${r.bytes}B via ${r.mode}, committed & pushed.`);
          completedThisSession++;
          logEvent({ event: 'task_done', round, receipt: result.receipt, bytes: r.bytes, mode: r.mode });
        }

        // Session budget reached — stop cleanly. Progress is already committed
        // in agents.md, so the next run resumes at the first unfinished task.
        if (global.__shouldStop && global.__shouldStop()) {
          const left = countTodo();
          console.log(`\n  ⏹  Stopped by request after ${completedThisSession} task(s).`);
          console.log(`     ${left} remaining — progress saved & pushed. Re-run to resume.`);
          break;
        }

        if (completedThisSession >= budget) {
          const left = countTodo();
          console.log(`\n  🛑 Session budget reached (${completedThisSession} task(s) done).`);
          if (left > 0) {
            console.log(`     ${left} task(s) still to do — progress is saved & pushed.`);
            console.log('     Resume any time with:');
            console.log(`       TASKS=${budget} node worker.js    (next ${budget})`);
            console.log('       node worker.js                (finish everything)');
          } else {
            console.log('     🎉 That was the last one — project complete!');
          }
          break;
        }
        consecutiveFailures = 0; // a clean round resets the counter
      } catch (e) {
        consecutiveFailures++;
        logEvent({ event: 'apply_failed', round, receipt: result.receipt, error: e.message, gate: !!e.gateFailure });
        console.error(`\n  ❌ Could not apply drop: ${e.message}`);
        if (e.gateFailure) {
          console.error('     The agent\'s code did not pass validation; nothing was committed.');
        }
        if (consecutiveFailures >= CONFIG.maxConsecutiveFailures) {
          console.error(`     ${consecutiveFailures} failures in a row — stopping for review.`);
          break;
        }
        console.error(
          `     Retrying (${consecutiveFailures}/${CONFIG.maxConsecutiveFailures} consecutive failures).`
        );
        continue;
      }
    }
  } catch (err) {
    console.error('\n  ❌ Worker error:', err.message);
  } finally {
    cleanup();
  }

  // Session summary — always tell the user exactly where they left off.
  try {
    const left = countTodo();
    const total = (fs.readFileSync(CONFIG.brainFile, 'utf8').match(/^\*\*STATUS:\s*(TODO|DONE)\*\*\s*$/gim) || []).length;
    console.log('\n────────────── session summary ──────────────');
    console.log(`  completed this session : ${completedThisSession}`);
    console.log(`  overall progress       : ${total - left}/${total} done`);
    if (left > 0) {
      console.log(`  remaining              : ${left}`);
      console.log('\n  Resume any time:');
      console.log('    npm run status        # see where you are');
      console.log('    TASKS=5 node worker.js  # next 5 tasks');
      console.log('    node worker.js          # finish everything');
    } else {
      console.log('\n  🎉 All tasks complete.');
    }
    console.log('─────────────────────────────────────────────');
  } catch {}

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
function selfTest(baseUrl, { timeoutMs = 90000, onProgress = () => {} } = {}) {
  const mod = baseUrl.startsWith('https') ? require('https') : require('http');
  const started = Date.now();
  const host = new URL(baseUrl).hostname;

  // Connect by IP when we can resolve one (DoH), else let the OS try by name.
  const probe = (ip) =>
    new Promise((resolve) => {
      const req = mod.get(
        {
          host: ip || host,
          servername: host, // correct SNI when connecting by IP
          headers: { Host: host, 'User-Agent': 'agentchain-selftest' },
          path: '/health',
          port: baseUrl.startsWith('https') ? 443 : 80,
          timeout: 10000,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString();
            if (res.statusCode === 200 && body.includes('"ok"')) resolve({ ok: true });
            else resolve({ ok: false, error: `HTTP ${res.statusCode}: ${body.slice(0, 100)}` });
          });
        }
      );
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timed out' }); });
      req.on('error', (e) => resolve({ ok: false, error: e.code || e.message }));
    });

  return (async () => {
    let last = { ok: false, error: 'no attempt made' };
    let n = 0;
    while (Date.now() - started < timeoutMs) {
      const ip = await resolveAny(host).catch(() => null);
      last = await probe(ip); // ip may be null — probe by name as a fallback
      if (last.ok) return { ok: true, ms: Date.now() - started, ip };
      n++;
      if (n === 3 || n % 8 === 0) {
        onProgress(`${last.error} — retrying (${Math.round((Date.now() - started) / 1000)}s)`);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return { ...last, ms: Date.now() - started };
  })();
}


/**
 * Confirm the remote's HEAD matches ours before the next agent clones.
 *
 * Deterministic alternative to "sleep 10s and hope". `git ls-remote` asks the
 * server what it actually has, so we wait exactly as long as needed — usually
 * zero, because git push is synchronous and GitHub is consistent for the
 * subsequent clone. Cheap insurance, no wasted time.
 */
function waitForRemoteSync(timeoutMs = 30000) {
  const local = shQuiet('git rev-parse HEAD').trim();
  if (!local) return;
  const branch = (shQuiet('git rev-parse --abbrev-ref HEAD').trim() || 'main');
  const started = Date.now();
  let warned = false;

  while (Date.now() - started < timeoutMs) {
    const out = shQuiet(`git ls-remote origin ${branch}`).trim();
    const remote = out.split(/\s+/)[0] || '';
    if (remote === local) {
      const ms = Date.now() - started;
      if (ms > 1500) console.log(`  ✅ remote in sync after ${Math.round(ms / 1000)}s`);
      return;
    }
    if (!warned) {
      console.log('  ⏳ waiting for the remote to reflect our push…');
      warned = true;
    }
    execSync(process.platform === 'win32' ? 'timeout /t 2 /nobreak > NUL' : 'sleep 2', {
      stdio: 'ignore',
    });
  }
  console.log('  ⚠️  remote still behind after 30s — continuing anyway.');
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

    if (CONFIG.sentinelFailedRegex.test(fresh)) {
      const line = fresh.split('\n').find((l) => l.includes('HANDOFF_FAILED')) || '';
      return { kind: 'failed', reason: line.replace(/%%%HANDOFF_FAILED%%%/g, '').trim() };
    }
    if (CONFIG.sentinelDoneRegex.test(fresh)) return { kind: 'done' };

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
