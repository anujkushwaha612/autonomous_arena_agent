'use strict';
/**
 * Turn the quality gate from a JUDGE into a TEACHER.
 *
 * THE PROBLEM
 * The worker used to close the browser as soon as the agent produced a receipt,
 * and only THEN run the gate. So when the gate found a bug, the agent that
 * wrote it was already gone. The round was thrown away and a fresh agent — with
 * no idea what went wrong — started the same task from scratch, very often
 * making the same mistake.
 *
 * THE FIX
 * Keep the chat open until the patch is accepted. When the gate rejects, paste
 * the exact errors back into the SAME conversation. The agent still has full
 * context: it knows what it wrote and why, so a targeted fix is usually one
 * short turn away.
 *
 * This module builds that feedback message. It is deliberately blunt and
 * specific — vague feedback ("it failed") produces vague fixes.
 */

/** Errors we can explain especially well, with actionable guidance. */
const HINTS = [
  {
    rx: /calls (\S+)\.(\w+)\(\) but (\S+) does not export it/,
    hint: (m) =>
      `Implement \`${m[2]}\` in \`${m[3]}\` and add it to that file's exports — ` +
      `or stop calling it. A missing export crashes at runtime even though the file parses.`,
  },
  {
    rx: /env files must not be committed/,
    hint: () =>
      `Delete the env file from the patch, add it to .gitignore, and commit a ` +
      `\`.env.example\` with placeholder values instead.`,
  },
  {
    rx: /possible (.+) committed/,
    hint: (m) =>
      `Remove the hard-coded ${m[1]}. Read it from an environment variable and ` +
      `document the variable in \`.env.example\`.`,
  },
  {
    rx: /is not recognized as an internal or external command/i,
    hint: () =>
      `That npm script is POSIX-only and fails on Windows. Never put \`VAR=value\` ` +
      `inline in a script — use the \`cross-env\` package, or read the variable in ` +
      `code with a default.`,
  },
  {
    rx: /server exited early|never opened port/i,
    hint: () =>
      `\`npm start\` must boot a server on \`process.env.PORT || 3000\` and keep ` +
      `running. Check the server output above — it usually names the real error.`,
  },
  {
    rx: /must export a function/i,
    hint: () =>
      `Each test file must export a single async function: ` +
      `\`module.exports = async (t) => {…}\` (CommonJS) or ` +
      `\`export default async (t) => {…}\` (ESM).`,
  },
  {
    // Anchored to real compiler output. A bare /unexpected/ also matched
    // ordinary prose like "something unexpected", producing a misleading hint.
    rx: /SyntaxError|syntax error|py_compile|unexpected (token|end of|identifier|indent|EOF)/i,
    hint: () => `Fix the syntax error, then re-run the file's syntax check before uploading.`,
  },
  {
    rx: /smoke:|test\.js:/,
    hint: () =>
      `Run \`node fastcapture/smoke.js\` locally and make every test pass — ` +
      `including tests written by earlier tasks. If you broke one, you broke their feature.`,
  },
  {
    rx: /did not apply cleanly|stale base/i,
    hint: () =>
      `Your diff was built against an out-of-date base. Run \`git pull --rebase\`, ` +
      `redo the change on top of the current code, and upload a fresh patch.`,
  },
];

function hintFor(error) {
  for (const h of HINTS) {
    const m = error.match(h.rx);
    if (m) return h.hint(m);
  }
  return null;
}

/**
 * Build the message pasted back into the live chat after a rejection.
 *
 * @param {object} o
 * @param {string[]} o.errors      individual problems found
 * @param {number}   o.attempt     which repair attempt this is (1-based)
 * @param {number}   o.maxAttempts total attempts allowed
 * @param {string}   o.ingestUrl   where to re-upload
 * @param {string}   o.ingestToken auth token
 * @param {number|string} o.round
 * @param {string}   o.nonce       anchor nonce for this round
 * @returns {string}
 */
function buildFeedback({ errors, attempt, maxAttempts, ingestUrl, ingestToken, round, nonce }) {
  const list = errors
    .map((e, i) => {
      // Gate errors can be multi-line (a whole smoke transcript). Keep the
      // signal, drop the noise, so the chat message stays small.
      const trimmed = String(e)
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 12)
        .join('\n      ');
      const hint = hintFor(String(e));
      return `${i + 1}. ${trimmed}${hint ? `\n   → ${hint}` : ''}`;
    })
    .join('\n');

  const last = attempt >= maxAttempts;

  return `❌ YOUR PATCH WAS REJECTED — it was NOT committed. The repository is unchanged.

The automated quality gate found ${errors.length} problem(s):

${list}

Fix attempt ${attempt} of ${maxAttempts}.${last ? ' THIS IS YOUR LAST ATTEMPT.' : ''}

WHAT TO DO NOW — in your existing working directory, do NOT re-clone:

1. Fix every problem listed above. You still have all your work; just correct it.
2. Verify before you re-upload:
     node fastcapture/smoke.js
   Every test must pass, including tests from earlier tasks.
3. Re-stage and upload a NEW patch containing ALL your work (not just the fix —
   the previous patch was discarded entirely):

   git add -A
   git diff --cached --binary | gzip -9 -c > /tmp/patch.gz
   curl -sS --fail --retry 3 --max-time 60 \\
     -H "x-agent-token: ${ingestToken}" \\
     -H "content-type: application/octet-stream" \\
     --data-binary @/tmp/patch.gz \\
     "${ingestUrl}/patch?kind=patch&round=${round}"

4. Print ONLY the new receipt from the JSON response, on its own line:

%%%RECEIPT:xxxxxxxxxxxx%%%

Do not paste a diff. Do not explain at length. Fix, verify, upload, print the receipt.

###WORKER_ANCHOR_${nonce}###`;
}

module.exports = { buildFeedback, hintFor };
