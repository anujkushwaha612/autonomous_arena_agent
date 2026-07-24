#!/usr/bin/env node
/**
 * AgentChain worker — orchestrates the airgapped multi-agent loop on Arena.
 *
 * PATCH INTEGRITY: Agent base64-encodes `git diff --cached`. Base64 is
 *   [A-Za-z0-9+/=\n] only — immune to markdown rendering corruption.
 *
 * SENTINELS: Use %%%...%%% format (not ## which is markdown H2 heading).
 */

const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');

// ───────────────────────── CONFIG ────────────────────────────────────────────
const CONFIG = {
  repoRoot: process.cwd(),
  repoUrl: 'https://github.com/anujkushwaha612/autonomous_arena_agent.git',

  newChatUrl: 'https://arena.ai/agent',
  inputSelectors: [
    'textarea:not([id*="recaptcha"]):not([name*="recaptcha"]):not([class*="recaptcha"])',
    '[contenteditable="true"]:not([class*="recaptcha"])',
    '[role="textbox"]:not([class*="recaptcha"])',
  ],
  newChatSelectors: [
    'button:has-text("New")', 'a:has-text("New")',
    '[aria-label*="new" i]', '[data-testid*="new" i]',
  ],
  sendSelectors: [
    'button[type="submit"]',
    'button[aria-label*="send" i]', 'button[aria-label*="end" i]',
    '[data-testid*="send" i]',
  ],

  browserProfileDir: path.join(process.cwd(), '.arena-profile'),
  bootstrapFile: 'BOOTSTRAP.md',

  patchStartMarker: '═══PATCH_START═══',
  patchEndMarker: '═══PATCH_END═══',

  sentinelHandoff: '%%%HANDOFF_COMPLETE%%%',
  sentinelDone: '%%%ALL_DONE%%%',
  sentinelFailed: '%%%HANDOFF_FAILED%%%',

  pollIntervalMs: 3000,
  maxTaskMs: 15 * 60 * 1000,
  maxRounds: 20,
};
// ─────────────────────────────────────────────────────────────────────────────

function sh(cmd) {
  return execSync(cmd, { cwd: CONFIG.repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
}
function shQuiet(cmd) { try { return sh(cmd).toString(); } catch { return ''; } }

// ── main loop ────────────────────────────────────────────────────────────────
async function main() {
  console.log('AgentChain worker starting. Repo root:', CONFIG.repoRoot);

  for (let round = 1; round <= CONFIG.maxRounds; round++) {
    console.log(`\n================= ROUND ${round} =================`);
    shQuiet('git pull --ff-only');

    const bootstrap = fs.readFileSync(path.join(CONFIG.repoRoot, CONFIG.bootstrapFile), 'utf8');
    const nonce = `###WORKER_ANCHOR_${Date.now()}###`;
    const prompt = bootstrap + '\n\n' + nonce;

    const context = await chromium.launchPersistentContext(CONFIG.browserProfileDir, {
      headless: false,
      viewport: { width: 1366, height: 900 },
      permissions: ['clipboard-read', 'clipboard-write'],
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-infobars'
      ],
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    });
    const page = context.pages()[0] || (await context.newPage());

    try {
      await page.goto(CONFIG.newChatUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await ensureLoggedIn(page);
      await tryNewChat(page);
      await typePrompt(page, prompt);
      await submit(page);

      const result = await waitForResult(page, nonce);

      if (result.kind === 'failed') { console.log('\n❌ Agent reported HANDOFF_FAILED:', result.reason); break; }
      if (result.kind === 'timeout') { console.log('\n⏰ Timed out waiting for the agent. Stopping for review.'); break; }
      
      // Handle ALL_DONE - but first check if there's a patch to commit (agent may have updated agents.md/NEXT.md)
      if (result.kind === 'done') {
        console.log('\n✅ Agent reports ALL tasks done.');
        
        // VALIDATION: Check if there are actually no TODO tasks left
        const agentsContent = fs.readFileSync(path.join(CONFIG.repoRoot, 'agents.md'), 'utf8');
        const todoMatches = agentsContent.match(/STATUS:\s*TODO/gi);
        const todoCount = todoMatches ? todoMatches.length : 0;
        
        if (todoCount > 0) {
          console.log(`  ⚠️  WARNING: Agent reported ALL_DONE but ${todoCount} TODO task(s) still exist!`);
          console.log('  ⚠️  Agent did not complete all tasks. Running another round...');
          continue; // Don't break, run another round
        }
        
        if (result.patch && result.patch.trim()) {
          console.log('  → Agent also provided a patch (likely updated agents.md/NEXT.md)');
          const ok = applyAndPush(result.patch, round);
          if (ok) {
            console.log(`  ✅ Final changes committed & pushed: "agent: round ${round} (final)"`);
          } else {
            console.log('  ⚠️  Failed to apply final patch, but continuing with ALL_DONE');
          }
        } else {
          console.log('  → No patch provided with ALL_DONE (nothing to commit)');
        }
        console.log('\n🎉 Project complete!');
        break;
      }
      
      // Handle normal handoff with patch
      if (!result.patch || !result.patch.trim()) { 
        console.log('\n❌ Sentinel found but no patch could be parsed. Stopping.'); 
        break; 
      }

      const ok = applyAndPush(result.patch, round);
      if (!ok) break;
      console.log(`Round ${round} committed & pushed. Continuing...`);
      
      // Wait for GitHub to fully process the push before next agent clones
      console.log('  ⏳ Waiting 10s for GitHub to stabilize...');
      await new Promise(resolve => setTimeout(resolve, 10000));
      console.log('  ✅ Ready for next round.');
    } catch (err) {
      console.error('Error during round', round, ':', err.message);
      break;
    } finally {
      await context.close();
    }
  }
  console.log('\nWorker finished.');
  process.exit(0);
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function findComposer(page) {
  const sel = CONFIG.inputSelectors.join(', ');
  const visible = page.locator(sel).filter({ visible: true });
  const n = await visible.count().catch(() => 0);
  if (n === 0) return null;
  return visible.last();
}

async function ensureLoggedIn(page) {
  if ((await findComposer(page)) !== null) return;
  console.log('\nNo visible chat input found — please LOG IN to Arena in the browser window. Waiting...');
  while ((await findComposer(page)) === null) {
    await page.waitForTimeout(2000);
  }
  console.log('Visible composer detected. Continuing.');
}

async function tryNewChat(page) {
  for (const sel of CONFIG.newChatSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.count().catch(() => 0) > 0) {
      await btn.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(800);
      return;
    }
  }
}

async function typePrompt(page, text) {
  let input = await findComposer(page);
  if (!input) {
    console.log('No composer found yet — waiting up to 15s for it to appear...');
    await page.locator(CONFIG.inputSelectors.join(', ')).filter({ visible: true }).first()
      .waitFor({ state: 'visible', timeout: 15000 });
    input = await findComposer(page);
  }

  await input.focus();
  await input.click({ delay: 100 });

  try {
    await input.fill(text);
    await page.waitForTimeout(500);
    if (await entered(page, text)) return;
  } catch (e) {}

  try {
    await page.evaluate(t => navigator.clipboard.writeText(t), text);
    await page.keyboard.press('Control+V');
    await page.waitForTimeout(800);
    if (await entered(page, text)) return;
  } catch (e) {}

  console.log('Clipboard/fill failed — inserting text atomically...');
  await input.click();
  await input.focus();
  await page.keyboard.insertText(text);
  await page.waitForTimeout(500);
}

async function entered(page, text) {
  const tail = text.slice(-40);
  return page.evaluate(t => (document.body.innerText || '').includes(t), tail);
}

async function submit(page) {
  for (const sel of CONFIG.sendSelectors) {
    const btn = page.locator(sel).filter({ visible: true }).last();
    if (await btn.count().catch(() => 0) > 0) {
      await btn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
      return;
    }
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
}

// ── result waiting & patch extraction ────────────────────────────────────────

async function waitForResult(page, nonce) {
  const deadline = Date.now() + CONFIG.maxTaskMs;
  let lastLog = 0;
  let sentinelDetected = null;
  let sentinelDetectedAt = 0;
  const SETTLE_TIME_MS = 60000; // Wait 60 seconds after sentinel to ensure output is complete

  while (Date.now() < deadline) {
    // Use only bodyText for sentinel detection — it's the cleanest single source
    // and avoids the duplication bug where combining bodyText + codeText + textContent
    // causes base64 blobs to appear multiple times, corrupting patch extraction.
    const bodyText = await page.evaluate(() => document.body.innerText || '');

    const anchor = bodyText.lastIndexOf(nonce);
    const fresh = anchor >= 0 ? bodyText.slice(anchor + nonce.length) : bodyText;

    // Check for sentinels
    if (!sentinelDetected) {
      if (checkSentinel(fresh, CONFIG.sentinelDone)) {
        console.log('  → Detected: ALL_DONE sentinel');
        sentinelDetected = 'done';
        sentinelDetectedAt = Date.now();
        console.log(`  ⏳ Waiting ${SETTLE_TIME_MS/1000}s for agent to finish outputting...`);
      } else if (checkSentinel(fresh, CONFIG.sentinelFailed)) {
        const line = fresh.split('\n').find(l => l.includes('HANDOFF_FAILED')) || '';
        console.log('  → Detected: HANDOFF_FAILED sentinel');
        return { kind: 'failed', reason: line.replace(/[%]*HANDOFF_FAILED[%]*/g, '').trim() };
      } else if (checkSentinel(fresh, CONFIG.sentinelHandoff)) {
        console.log('  → Detected: HANDOFF_COMPLETE sentinel');
        sentinelDetected = 'handoff';
        sentinelDetectedAt = Date.now();
        console.log(`  ⏳ Waiting ${SETTLE_TIME_MS/1000}s for agent to finish outputting...`);
      }
    }

    // If sentinel was detected, wait for settle time before extracting
    if (sentinelDetected && (Date.now() - sentinelDetectedAt >= SETTLE_TIME_MS)) {
      console.log('  → Settle time complete, extracting patch...');
      
      // Re-fetch page content — try multiple independent sources to find the best one.
      // CRITICAL: Do NOT combine sources into one string! That causes base64 duplication.
      const sources = await page.evaluate(() => {
        // Source 1: innerText (what you see on screen, no hidden elements)
        const bodyText = document.body.innerText || '';
        // Source 2: code blocks only (Arena renders base64 in <pre><code>)
        const codeBlocks = document.querySelectorAll('pre code, pre');
        const codeTexts = [];
        codeBlocks.forEach(el => { codeTexts.push(el.textContent || ''); });
        return JSON.stringify({ bodyText, codeTexts });
      });

      const { bodyText: finalBody, codeTexts } = JSON.parse(sources);
      
      // Try extracting from each source independently, prefer the one that works
      const finalAnchor = finalBody.lastIndexOf(nonce);
      const finalFresh = finalAnchor >= 0 ? finalBody.slice(finalAnchor + nonce.length) : finalBody;
      
      // First try: extract from bodyText (most reliable single source)
      let patch = extractPatch(finalFresh);
      
      // Second try: if bodyText failed, try each code block individually
      if (!patch) {
        console.log('  → bodyText extraction failed, trying code blocks individually...');
        for (const codeText of codeTexts) {
          if (codeText.length > 50) {
            patch = extractPatch(codeText);
            if (patch) {
              console.log('  → Found valid patch in a code block');
              break;
            }
          }
        }
      }
      
      if (sentinelDetected === 'done') {
        if (patch) {
          console.log('  → Agent also provided a patch with ALL_DONE');
        }
        return { kind: 'done', patch };
      } else if (sentinelDetected === 'handoff') {
        return { kind: 'handoff', patch };
      }
    }

    const now = Date.now();
    if (now - lastLog > 30000) {
      const elapsed = Math.round((now - (deadline - CONFIG.maxTaskMs)) / 1000);
      console.log(`  ⏳ Waiting for agent... (${elapsed}s elapsed, ${Math.round((deadline - now) / 1000)}s remaining)`);
      lastLog = now;
    }

    await page.waitForTimeout(CONFIG.pollIntervalMs);
  }
  return { kind: 'timeout' };
}

function checkSentinel(text, sentinel) {
  if (text.includes(sentinel)) return true;
  const core = sentinel.replace(/[^A-Z_]/g, '');
  if (core && text.includes(core)) {
    const regex = new RegExp(`[^A-Za-z_]${core}[^A-Za-z_]`, 'i');
    if (regex.test(text) || text.startsWith(core) || text.endsWith(core)) {
      console.log(`  → Found sentinel core "${core}" (markdown may have stripped decorators)`);
      return true;
    }
  }
  return false;
}

function extractPatch(fresh) {
  // Use indexOf (not lastIndexOf) for end marker to ensure we match within the SAME
  // occurrence of the markers, not across duplicated content.
  const start = fresh.indexOf(CONFIG.patchStartMarker);
  let end = -1;
  if (start !== -1) {
    // Search for end marker AFTER the start marker only
    end = fresh.indexOf(CONFIG.patchEndMarker, start + CONFIG.patchStartMarker.length);
  }

  let raw = null;
  if (start !== -1 && end !== -1 && end > start) {
    raw = fresh.slice(start + CONFIG.patchStartMarker.length, end).trim();
    console.log(`  → Found patch between markers (${raw.length} chars)`);
  } else {
    // Also try Unicode-normalized markers (Arena may mangle the ═ characters)
    const normalizedFresh = fresh.normalize('NFKC');
    const nStart = normalizedFresh.indexOf(CONFIG.patchStartMarker);
    if (nStart !== -1) {
      const nEnd = normalizedFresh.indexOf(CONFIG.patchEndMarker, nStart + CONFIG.patchStartMarker.length);
      if (nEnd !== -1 && nEnd > nStart) {
        raw = normalizedFresh.slice(nStart + CONFIG.patchStartMarker.length, nEnd).trim();
        console.log(`  → Found patch between markers after Unicode normalization (${raw.length} chars)`);
      }
    }
    if (!raw) {
      console.log('  → Markers not found. Scanning for base64 blob in text...');
      raw = findBase64Blob(fresh);
    }
  }

  if (!raw) {
    console.log('  → No base64 blob found. Trying ```diff block fallback...');
    const regex = /```(?:diff|patch)?\s*([\s\S]*?)\s*```/gi;
    let match;
    while ((match = regex.exec(fresh)) !== null) {
      if (match[1] && match[1].includes('diff --git')) {
        raw = match[1].trim();
        break;
      }
    }
  }

  if (!raw) {
    console.log('  → Could not extract any patch content from the page.');
    return null;
  }

  // Validate that the agent didn't just output placeholder text
  if (raw.includes('PASTE_THE') || raw.includes('YOUR_ACTUAL') || raw.includes('PLACEHOLDER')) {
    console.log('  ❌ Agent output placeholder text instead of actual patch!');
    console.log('  ❌ The agent did not complete the work. Rejecting this patch.');
    return null;
  }

  const patch = tryBase64Decode(raw);
  if (patch) {
    // Validate the decoded patch for markdown corruption
    const isCorrupted = detectMarkdownCorruption(patch);
    if (isCorrupted) {
      console.log('  ⚠️  WARNING: Decoded patch contains markdown artifacts!');
      console.log('  ⚠️  The agent likely read the diff from chat instead of piping correctly.');
      console.log('  ⚠️  Attempting best-effort sanitization...');
      const sanitized = deepSanitize(patch);
      const stillCorrupted = detectMarkdownCorruption(sanitized);
      if (stillCorrupted) {
        console.log('  ❌ Sanitization incomplete. Patch may fail to apply.');
        console.log('  💡 TIP: Check if the agent ran: git diff --cached | base64 -w 0 > patch.b64');
      } else {
        console.log('  ✅ Sanitization successful!');
      }
      return sanitized;
    }
    console.log('  ✅ Patch decoded from base64 — clean and valid.');
    return patch;
  }

  console.log('  ⚠️  Base64 decode failed. Falling back to raw diff sanitization...');
  return sanitizeRawDiff(raw);
}

function findBase64Blob(text) {
  // First try: find a contiguous base64 blob (no whitespace)
  const match = text.match(/[A-Za-z0-9+/=]{100,}/);
  if (match) {
    console.log(`  → Found potential base64 blob (${match[0].length} chars)`);
    return match[0];
  }
  // Second try: find base64 with embedded newlines/spaces (some renderers wrap long lines)
  const multilineMatch = text.match(/([A-Za-z0-9+/=][A-Za-z0-9+/=\s]{98,}[A-Za-z0-9+/=])/);
  if (multilineMatch) {
    const cleaned = multilineMatch[1].replace(/\s+/g, '');
    if (cleaned.length >= 100) {
      console.log(`  → Found potential multiline base64 blob (${cleaned.length} chars after whitespace removal)`);
      return cleaned;
    }
  }
  return null;
}

function tryBase64Decode(raw) {
  const cleaned = raw.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(cleaned)) {
    console.log('  → Content contains non-base64 characters, skipping decode.');
    return null;
  }
  if (cleaned.length < 50) {
    console.log('  → Base64 string too short, likely not a real patch.');
    return null;
  }
  
  console.log(`  → Base64 string length: ${cleaned.length} chars`);
  const decodedBuf = Buffer.from(cleaned, 'base64');
  console.log(`  → Decoded buffer size: ${decodedBuf.length} bytes`);
  
  // Try gzip decompression first (new format: git diff --cached | gzip -c | base64)
  try {
    const decompressed = zlib.gunzipSync(decodedBuf).toString('utf8');
    console.log(`  → Gzip decompressed to ${decompressed.length} chars`);
    if (decompressed.includes('diff --git') && decompressed.includes('---') && decompressed.includes('+++')) {
      console.log(`  ✅ Gzip decompression successful (${cleaned.length} → ${decompressed.length} chars)`);
      return decompressed;
    } else {
      console.log('  ⚠️  Gzip decompressed but missing diff markers');
      console.log(`  ⚠️  First 200 chars: ${decompressed.substring(0, 200)}`);
    }
  } catch (e) {
    console.log(`  ⚠️  Gzip decompression failed: ${e.message}`);
    if (e.message.includes('incorrect data check') || e.message.includes('unexpected end of file')) {
      console.log('  ⚠️  This error typically means the base64 was TRUNCATED (incomplete output)');
      console.log('  ⚠️  The agent was likely still outputting when we extracted the patch');
      console.log('  ⚠️  Try increasing SETTLE_TIME_MS or wait longer for output to complete');
    }
    // Not gzipped or corrupted, fall through to plain base64
  }
  
  // Fall back to plain base64 (old format: git diff --cached | base64)
  try {
    const decoded = decodedBuf.toString('utf8');
    if (!decoded.includes('diff --git')) {
      console.log('  → Decoded text does not contain "diff --git".');
      return null;
    }
    if (!decoded.includes('---') || !decoded.includes('+++')) {
      console.log('  → Decoded text missing --- / +++ headers.');
      return null;
    }
    console.log('  → Using plain base64 decode (no gzip compression detected)');
    return decoded;
  } catch (e) {
    console.log('  → Base64 decode error:', e.message);
    return null;
  }
}

/**
 * Detect if a patch contains markdown corruption artifacts.
 */
function detectMarkdownCorruption(text) {
  // Check for markdown link patterns
  if (/\[.*\]\(http/.test(text)) return true;
  // Check for HTML entities
  if (/&(amp|lt|gt|quot|#39);/.test(text)) return true;
  // Check for ** bold markers in diff headers
  if (/^\*\*diff --git/m.test(text)) return true;
  return false;
}

/**
 * Deep sanitization for markdown-corrupted patches.
 * Attempts to fix file paths and common patterns.
 */
function deepSanitize(text) {
  let result = text;
  
  // Fix file paths in diff headers (most critical for git apply)
  // Pattern: a/[[[filename](url)]...] b/[[[filename](url)]...]
  result = result.replace(/^diff --git a\/(.+?) b\/(.+?)$/gm, (match, aPath, bPath) => {
    const cleanA = extractFilename(aPath);
    const cleanB = extractFilename(bPath);
    return `diff --git a/${cleanA} b/${cleanB}`;
  });
  
  // Fix --- and +++ paths
  result = result.replace(/^--- a\/(.+?)$/gm, (match, path) => `--- a/${extractFilename(path)}`);
  result = result.replace(/^\+\+\+ b\/(.+?)$/gm, (match, path) => `+++ b/${extractFilename(path)}`);
  
  // Recursively strip markdown links from content
  let prev;
  let iterations = 0;
  do {
    prev = result;
    result = result.replace(/\]\([^)]*\)/g, '');
    iterations++;
  } while (result !== prev && iterations < 20);
  
  // Remove brackets
  result = result.replace(/[\[\]]/g, '');
  
  // Clean up multiple parens
  result = result.replace(/\){2,}/g, ')');
  
  // Decode HTML entities
  iterations = 0;
  do {
    prev = result;
    result = result.replace(/&amp;/g, '&');
    result = result.replace(/&lt;/g, '<');
    result = result.replace(/&gt;/g, '>');
    result = result.replace(/&quot;/g, '"');
    result = result.replace(/&#39;/g, "'");
    result = result.replace(/&nbsp;/g, ' ');
    iterations++;
  } while (result !== prev && iterations < 30);
  
  // Strip ** bold markers
  result = result.replace(/\*\*/g, '');
  
  return result;
}

/**
 * Extract clean filename from corrupted markdown link pattern.
 * E.g., "[[[NEXT.md](http://NEXT.md)](..." → "NEXT.md"
 */
function extractFilename(corrupted) {
  // Try to find the first occurrence of a filename-like pattern
  const match = corrupted.match(/([a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+)/);
  if (match) return match[1];
  // Fallback: remove all markdown artifacts
  return corrupted.replace(/\[.*?\]\(.*?\)/g, '').replace(/[\[\]()]/g, '').trim();
}

function sanitizeRawDiff(raw) {
  let patch = raw;
  patch = patch.replace(/\*\*/g, '');
  patch = patch.replace(/(?<!\w)\*(?!\*)/g, '');
  patch = patch.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  patch = patch.replace(/&amp;/g, '&');
  patch = patch.replace(/&lt;/g, '<');
  patch = patch.replace(/&gt;/g, '>');
  patch = patch.replace(/&quot;/g, '"');
  patch = patch.replace(/&#39;/g, "'");
  patch = patch.replace(/&nbsp;/g, ' ');
  patch = patch.replace(/^```(?:diff|patch)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  const lines = patch.split('\n');
  const sanitized = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const trimmed = line.trim();
    if (trimmed === 'text' || trimmed === 'diff' || trimmed === 'patch') continue;
    line = line.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    line = line.replace(/\*\*/g, '');
    sanitized.push(line);
  }

  let result = sanitized.join('\n');
  const outLines = result.split('\n');
  const final = [];
  for (let i = 0; i < outLines.length; i++) {
    const line = outLines[i];
    final.push(line);
    if (/^(diff --git|index |--- |\+\+\+ |@@ )/.test(line)) {
      if (outLines[i + 1] !== undefined && outLines[i + 1].trim() === '') {
        i++;
      }
    }
  }

  return final.join('\n').trim();
}

// ── apply & push ─────────────────────────────────────────────────────────────

function applyAndPush(patchText, round) {
  const patchFile = path.join(os.tmpdir(), `agentchain_${round}_${Date.now()}.patch`);

  let cleanPatch = patchText.replace(/\r\n/g, '\n');
  cleanPatch = cleanPatch.trim() + '\n';

  fs.writeFileSync(patchFile, cleanPatch);

  if (!cleanPatch.includes('diff --git')) {
    console.error('\n❌ Patch does not contain "diff --git" — not a valid git patch.');
    console.error('Patch saved at:', patchFile);
    return false;
  }

  try {
    sh(`git apply --check --ignore-space-change --ignore-whitespace "${patchFile}"`);
    console.log('  ✅ Patch validation passed.');
  } catch (e) {
    console.warn('\n  ⚠️ Strict git apply --check failed. Trying 3-way merge...');
    try {
      sh(`git apply --check --3way "${patchFile}"`);
      console.log('  ✅ 3-way merge validation passed.');
    } catch (e2) {
      console.error('\n  ❌ git apply --check FAILED — patch cannot be applied.');
      console.error((e2.stderr && e2.stderr.toString()) || e2.message);
      console.error('  Patch saved at:', patchFile);

      const preview = cleanPatch.split('\n').slice(0, 20).join('\n');
      console.error('\n  --- Patch preview (first 20 lines) ---');
      console.error(preview);
      console.error('  --- End preview ---');
      return false;
    }
  }

  try {
    sh(`git apply --ignore-space-change --ignore-whitespace "${patchFile}"`);
  } catch (err) {
    sh(`git apply --3way "${patchFile}"`);
  }

  sh('git add -A');
  sh(`git commit -m "agent: round ${round}"`);
  sh('git push');
  console.log(`  ✅ Applied & pushed: "agent: round ${round}"`);
  return true;
}

main().catch(e => { console.error(e); process.exit(1); });
