'use strict';
/**
 * Single source of truth for the whole pipeline.
 * Everything can be overridden with env vars, but the defaults are chosen so
 * that a bare `node worker.js` just works.
 */

const path = require('path');
const crypto = require('crypto');

const repoRoot = __dirname;

module.exports = {
  repoRoot,

  // ── your project ───────────────────────────────────────────────────────────
  // The repo the agent clones and you push to.
  repoUrl:
    process.env.REPO_URL ||
    'https://github.com/anujkushwaha612/autonomous_arena_agent.git',

  // ── ingest (out-of-band patch channel) ────────────────────────────────────
  ingestPort: Number(process.env.INGEST_PORT || 8787),
  // Random per-run unless you pin it. The agent only needs it for one round.
  ingestToken: process.env.INGEST_TOKEN || crypto.randomBytes(16).toString('hex'),
  dropDir: process.env.DROP_DIR || path.join(repoRoot, 'fastcapture', 'drops'),
  runLogFile: path.join(repoRoot, 'run.log.jsonl'),

  // Public URL the AGENT SANDBOX will POST to.
  // Leave unset and the worker auto-starts a cloudflared quick tunnel.
  ingestUrl: process.env.INGEST_URL || null,
  // Set TUNNEL=off to skip tunnelling (e.g. you already expose the port).
  tunnel: process.env.TUNNEL !== 'off',

  // ── browser automation ────────────────────────────────────────────────────
  newChatUrl: process.env.ARENA_URL || 'https://arena.ai/agent',
  browserProfileDir: path.join(repoRoot, '.arena-profile'),
  headless: process.env.HEADLESS === 'true',

  inputSelectors: [
    'textarea:not([id*="recaptcha"]):not([name*="recaptcha"]):not([class*="recaptcha"])',
    '[contenteditable="true"]:not([class*="recaptcha"])',
    '[role="textbox"]:not([class*="recaptcha"])',
  ],
  newChatSelectors: [
    'button:has-text("New")',
    'a:has-text("New")',
    '[aria-label*="new" i]',
    '[data-testid*="new" i]',
  ],
  sendSelectors: [
    'button[type="submit"]',
    'button[aria-label*="send" i]',
    'button[aria-label*="end" i]',
    '[data-testid*="send" i]',
  ],

  // ── protocol ──────────────────────────────────────────────────────────────
  promptFile: path.join(repoRoot, 'AGENT_PROMPT.md'),
  brainFile: path.join(repoRoot, 'agents.md'),
  nextFile: path.join(repoRoot, 'NEXT.md'),

  // Sentinels must appear ON THEIR OWN LINE. A plain substring check fires
  // when the agent merely *quotes* the instruction while thinking out loud
  // ("if there were no tasks I'd output %%%ALL_DONE%%%"), which wastes a round.
  sentinelDoneRegex: /^\s*%*\s*ALL_DONE\s*%*\s*$/m,
  sentinelFailedRegex: /^\s*%%%HANDOFF_FAILED%%%/m,
  // The receipt IS the handoff. No separate completion sentinel needed.
  receiptRegex: /%%%RECEIPT:([0-9a-f]{12})%%%/,

  // ── timing ────────────────────────────────────────────────────────────────
  pollIntervalMs: 2000,
  maxTaskMs: 20 * 60 * 1000,
  maxRounds: Number(process.env.MAX_ROUNDS || 50),

  // ── session batching ──────────────────────────────────────────────────────
  // How many tasks to complete in ONE sitting, then stop cleanly.
  //   TASKS=5 node worker.js   → do 5 tasks and exit
  //   node worker.js           → do everything (default)
  // Progress lives in agents.md (STATUS: DONE) which is committed, so the next
  // run automatically resumes at the first unfinished task.
  tasksPerSession: process.env.TASKS ? Number(process.env.TASKS) : Infinity,

  // Give up only after this many FAILED rounds in a row. A single flaky round
  // (bad tunnel, confused agent, hung page) shouldn't kill an overnight run;
  // nothing is committed on failure, so retrying the same task is safe.
  maxConsecutiveFailures: Number(process.env.MAX_FAILURES || 3),

  // ── quality gate ──────────────────────────────────────────────────────────
  // Validate the agent's work before committing. Syntax + JSON + contract
  // checks always run; VERIFY_CMD adds your own tests/lint/build.
  gateEnabled: process.env.GATE !== 'off',

  // ── repair loop ───────────────────────────────────────────────────────────
  // When the gate rejects a patch, paste the exact errors back into the SAME
  // chat so the agent that wrote the code can fix it with full context. This is
  // the difference between a gate that judges and a gate that teaches.
  //   REPAIR=off      disable entirely (one-shot agents)
  //   MAX_REPAIRS=3   how many fix attempts per round
  repairEnabled: process.env.REPAIR !== 'off',
  maxRepairAttempts: Number(process.env.MAX_REPAIRS || 2),

  // ── project shape (task-type agnostic) ────────────────────────────────────
  // Where the agent's work lives. Defaults to `app/` but can be anything:
  //   WORK_DIR=notebooks   (an ML project)
  //   WORK_DIR=docs        (a writing project)
  //   WORK_DIR=.           (work at the repo root)
  workDir: process.env.WORK_DIR || 'app',
  // Command that boots a long-running service for smoke tests. Set to '' for
  // projects with nothing to boot (data, docs, libraries, notebooks).
  //   SMOKE_CMD="python -m uvicorn main:app"   (FastAPI)
  //   SMOKE_CMD=""                              (no server; tests run directly)
  // NOTE: `??`, not `||` — SMOKE_CMD="" is a meaningful value meaning
  // "there is no server to boot", and `||` would silently ignore it.
  smokeCmd: process.env.SMOKE_CMD ?? 'npm start',
  // Runtime smoke tests: boot the app and exercise it.
  // Runtime verification. Three levels, so the pipeline suits any project type:
  //   SMOKE=off            no runtime checks at all (docs, data, research)
  //   SMOKE_CMD=""         no server to boot; just run the test files
  //   VERIFY_CMD="..."     use YOUR toolchain instead (pytest, go test, cargo)
  // Static checks (syntax, contracts, secrets) always run and are language-aware.
  // OFF by default. Measured over a long run, the smoke harness destroyed more
  // rounds through its own bugs (module loading, missing deps, TS loaders) than
  // it caught real defects — while the static contract check caught the worst
  // real bug (five missing exports) in 120ms with no harness at all.
  // Agents verify in their sandbox; turn this on when you want the operator's
  // machine to re-verify too (it is the only thing that catches OS-specific
  // bugs, e.g. a POSIX-only npm script failing on Windows).
  //   SMOKE=on node worker.js
  smokeEnabled: process.env.SMOKE === 'on',
  verifyCmd: process.env.VERIFY_CMD || null,
  verifyTimeoutMs: Number(process.env.VERIFY_TIMEOUT_MS || 300000),
  // No SETTLE_TIME. A partial receipt cannot match the regex, so there is
  // never a "looks complete but isn't" state to wait out.
};
