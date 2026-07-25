'use strict';
/**
 * Quality gate — validate the agent's work BEFORE it becomes a commit.
 *
 * Without this, a syntactically broken file applies cleanly, gets committed and
 * pushed, and the *next* agent clones the breakage and builds on top of it. One
 * bad round silently poisons the rest of the run.
 *
 * The gate runs against the working tree after `git apply` but before commit,
 * so a failure can be rolled back as if the round never happened.
 *
 * Deliberately cheap and dependency-free: syntax checks on changed files, plus
 * an optional user-supplied command (tests, lint, typecheck, build).
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { checkContracts } = require('./contract');
const { checkFile } = require('./languages');

/** Files touched by the staged/unstaged change, relative to repoRoot. */
function changedFiles(repoRoot) {
  // -uall is essential: without it a brand-new directory collapses to a single
  // "?? app/" entry and every file inside it escapes the gate entirely.
  let out;
  try {
    out = execSync('git status --porcelain -uall', {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
  } catch {
    return []; // not a git repo / git unavailable — nothing to gate
  }
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3).trim())
    .filter(Boolean)
    // handle renames: "old -> new"
    .map((f) => (f.includes(' -> ') ? f.split(' -> ')[1] : f))
    .map((f) => f.replace(/^"|"$/g, ''));
}

/**
 * Syntax-check every changed file using the right toolchain for its language.
 * Unknown file types and missing toolchains are skipped, never failed — the
 * runner shouldn't reject Go code just because Go isn't installed here.
 */
function checkSyntax(repoRoot, files) {
  const errors = [];
  for (const f of files) {
    const abs = path.join(repoRoot, f);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isDirectory()) continue;
    const err = checkFile(abs, f);
    if (err) errors.push(err);
  }
  return errors;
}

/** JSON parse check — a malformed package.json breaks every later round. */
function checkJson(repoRoot, files) {
  const errors = [];
  for (const f of files) {
    if (!/\.json$/.test(f)) continue;
    const abs = path.join(repoRoot, f);
    if (!fs.existsSync(abs)) continue;
    try {
      JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (e) {
      errors.push(`${f}: ${e.message}`);
    }
  }
  return errors;
}

/**
 * Secret / junk scanner.
 *
 * Two layers, because filename rules alone are not enough:
 *   1. FILENAMES that should never be committed (.env*, keys, keystores)
 *   2. CONTENT patterns for high-confidence credential formats, so a secret
 *      pasted into an ordinary .js or .json file is still caught.
 *
 * This matters more than it looks: a leaked credential in git history is
 * effectively permanent, and an autonomous agent commits without a human
 * eyeballing the diff first.
 */
const FORBIDDEN_NAMES = [
  { rx: /(^|\/)node_modules\//, msg: 'node_modules must not be committed' },
  // Real env files only. .env.example / .env.sample / .env.template are the
  // documented, intended way to ship config shape and must stay allowed.
  { rx: /(^|\/)\.env(\.(?!example$|sample$|template$|dist$)[A-Za-z0-9_-]+)?$/i,
    msg: 'env files must not be committed (commit .env.example instead)' },
  { rx: /(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519)$/, msg: 'looks like an SSH private key' },
  { rx: /\.(pem|key|p12|pfx|jks|keystore|ppk)$/i, msg: 'looks like a key or keystore' },
  { rx: /(^|\/)\.npmrc$/, msg: '.npmrc often contains auth tokens' },
  { rx: /(^|\/)\.git-credentials$/, msg: 'contains git credentials' },
  { rx: /(^|\/)(credentials|service-account.*\.json)$/i, msg: 'looks like a credentials file' },
  { rx: /\.(sqlite3?|db)$/i, msg: 'database file — data should not be committed' },
];

// High-confidence only. Deliberately NOT matching generic words like
// "password" or "secret", which would fire on docs, tests and .env.example
// and train people to ignore the gate.
const SECRET_PATTERNS = [
  { rx: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, msg: 'private key block' },
  { rx: /\bAKIA[0-9A-Z]{16}\b/, msg: 'AWS access key id' },
  { rx: /aws_secret_access_key["']?\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}/i, msg: 'AWS secret access key' },
  { rx: /\bsk_live_[0-9a-zA-Z]{20,}/, msg: 'Stripe live secret key' },
  { rx: /\bgh[pousr]_[A-Za-z0-9]{36,}/, msg: 'GitHub token' },
  { rx: /\bxox[baprs]-[A-Za-z0-9-]{10,}/, msg: 'Slack token' },
  { rx: /\bAIza[0-9A-Za-z_-]{35}\b/, msg: 'Google API key' },
  { rx: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, msg: 'hard-coded JWT' },
  { rx: /\b(postgres|postgresql|mysql|mongodb(\+srv)?|redis|amqp):\/\/[^\s:@/"']+:[^\s:@/"']+@/i,
    msg: 'connection string with an inline password' },
];

// Files where a fake credential is expected and fine.
const SECRET_SCAN_SKIP = /(^|\/)(\.env\.example|.*\.example|.*\.sample|.*\.md|package-lock\.json)$/i;

function checkForbidden(repoRoot, files) {
  const errors = [];

  for (const f of files) {
    for (const { rx, msg } of FORBIDDEN_NAMES) {
      if (rx.test(f)) { errors.push(`${f}: ${msg}`); break; }
    }
  }

  for (const f of files) {
    if (SECRET_SCAN_SKIP.test(f)) continue;
    const abs = path.join(repoRoot, f);
    let st;
    try { st = fs.statSync(abs); } catch { continue; }
    if (!st.isFile() || st.size > 2 * 1024 * 1024) continue; // skip huge/binary-ish

    let text;
    try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    if (text.includes('\u0000')) continue; // binary

    for (const { rx, msg } of SECRET_PATTERNS) {
      const m = text.match(rx);
      if (m) {
        const line = text.slice(0, m.index).split('\n').length;
        errors.push(`${f}:${line}: possible ${msg} committed — move it to an env var`);
        break; // one finding per file is enough to block
      }
    }
  }

  return errors;
}

/**
 * Run an optional user command (tests, lint, build).
 * Configured via VERIFY_CMD, e.g. VERIFY_CMD="npm test --prefix app".
 */
function runUserCommand(repoRoot, cmd, timeoutMs) {
  try {
    execSync(cmd, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      env: { ...process.env, CI: 'true' },
    });
    return [];
  } catch (e) {
    if (e.code === 'ETIMEDOUT') return [`\`${cmd}\` timed out after ${timeoutMs / 1000}s`];
    const out = [
      (e.stdout && e.stdout.toString()) || '',
      (e.stderr && e.stderr.toString()) || '',
    ]
      .join('\n')
      .trim()
      .split('\n')
      .slice(-15) // last lines are where the real error is
      .join('\n      ');
    return [`\`${cmd}\` failed:\n      ${out}`];
  }
}

/**
 * @returns {{ok: boolean, errors: string[], checked: number}}
 */
/**
 * Problems that already exist at HEAD, before this patch was applied.
 *
 * Without this the gate blames each agent for debt it inherited: a good task
 * gets rejected because an EARLIER task left a broken contract, and since the
 * new agent can't fix what it didn't touch, the worker fails identically every
 * round until it gives up. Only NEW problems should block a commit.
 */
function baselineErrors(repoRoot) {
  const os = require('os');
  let tmp = null;
  try {
    // Materialise HEAD into a temp dir and analyse THAT. Scanning the working
    // tree would include the agent's new code, so a genuinely new problem would
    // appear in the baseline and mask itself.
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-base-'));
    execSync(`git archive HEAD | tar -x -C "${tmp}"`, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });
    const walk = (dir, acc = []) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) walk(abs, acc);
        else if (/\.(js|cjs|mjs)$/.test(e.name)) {
          acc.push(path.relative(tmp, abs).split(path.sep).join('/'));
        }
      }
      return acc;
    };
    return new Set(checkContracts(tmp, walk(tmp)));
  } catch {
    return new Set();
  } finally {
    if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  }
}

function runGate(repoRoot, { userCmd = null, smoke = false, timeoutMs = 300000, log = () => {}, baseline = null } = {}) {
  const files = changedFiles(repoRoot);
  if (!files.length) return { ok: true, errors: [], checked: 0 };

  const errors = [
    ...checkForbidden(repoRoot, files),
    ...checkJson(repoRoot, files),
    ...checkSyntax(repoRoot, files),
  ];

  // Whole-program check: does every local module actually export what its
  // callers use? Catches the "X is not a function" crash that syntax checking
  // structurally cannot see.
  if (!errors.length) {
    const found = checkContracts(repoRoot, files);
    errors.push(...(baseline ? found.filter((e) => !baseline.has(e)) : found));
  }

  // Runtime smoke tests — the only check that catches integration bugs.
  if (!errors.length && smoke) {
    const smokePath = path.join(__dirname, 'smoke.js');
    if (fs.existsSync(smokePath)) {
      errors.push(...runUserCommand(repoRoot, `node "${smokePath}"`, timeoutMs));
    }
  }

  // Only spend time on the heavy command if the cheap checks passed.
  if (!errors.length && userCmd) {
    log(`  🧪 running: ${userCmd}`);
    errors.push(...runUserCommand(repoRoot, userCmd, timeoutMs));
  }

  return { ok: errors.length === 0, errors, checked: files.length };
}

module.exports = { runGate, changedFiles, baselineErrors };
