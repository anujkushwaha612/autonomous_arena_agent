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

/** Files touched by the staged/unstaged change, relative to repoRoot. */
function changedFiles(repoRoot) {
  // -uall is essential: without it a brand-new directory collapses to a single
  // "?? app/" entry and every file inside it escapes the gate entirely.
  const out = execSync('git status --porcelain -uall', { cwd: repoRoot }).toString();
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3).trim())
    .filter(Boolean)
    // handle renames: "old -> new"
    .map((f) => (f.includes(' -> ') ? f.split(' -> ')[1] : f))
    .map((f) => f.replace(/^"|"$/g, ''));
}

/** Node syntax check — catches unclosed braces, bad imports, typos. */
function checkJavaScript(repoRoot, files) {
  const errors = [];
  for (const f of files) {
    if (!/\.(js|mjs|cjs)$/.test(f)) continue;
    const abs = path.join(repoRoot, f);
    if (!fs.existsSync(abs)) continue;
    try {
      execSync(`node --check "${abs}"`, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const msg = ((e.stderr && e.stderr.toString()) || e.message).split('\n').slice(0, 3).join(' ');
      errors.push(`${f}: ${msg.trim()}`);
    }
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

/** Guard against secrets and junk the agent shouldn't have committed. */
function checkForbidden(repoRoot, files) {
  const errors = [];
  for (const f of files) {
    if (/(^|\/)node_modules\//.test(f)) errors.push(`${f}: node_modules must not be committed`);
    if (/(^|\/)\.env$/.test(f)) errors.push(`${f}: .env must not be committed`);
    if (/\.(pem|key|p12|pfx)$/.test(f)) errors.push(`${f}: looks like a private key`);
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
function runGate(repoRoot, { userCmd = null, timeoutMs = 300000, log = () => {} } = {}) {
  const files = changedFiles(repoRoot);
  if (!files.length) return { ok: true, errors: [], checked: 0 };

  const errors = [
    ...checkForbidden(repoRoot, files),
    ...checkJson(repoRoot, files),
    ...checkJavaScript(repoRoot, files),
  ];

  // Only spend time on the heavy command if the cheap checks passed.
  if (!errors.length && userCmd) {
    log(`  🧪 running: ${userCmd}`);
    errors.push(...runUserCommand(repoRoot, userCmd, timeoutMs));
  }

  return { ok: errors.length === 0, errors, checked: files.length };
}

module.exports = { runGate, changedFiles };
