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

  sentinelDone: '%%%ALL_DONE%%%',
  sentinelFailed: '%%%HANDOFF_FAILED%%%',
  // The receipt IS the handoff. No separate completion sentinel needed.
  receiptRegex: /%%%RECEIPT:([0-9a-f]{12})%%%/,

  // ── timing ────────────────────────────────────────────────────────────────
  pollIntervalMs: 2000,
  maxTaskMs: 20 * 60 * 1000,
  maxRounds: Number(process.env.MAX_ROUNDS || 20),
  // No SETTLE_TIME. A partial receipt cannot match the regex, so there is
  // never a "looks complete but isn't" state to wait out.
};
