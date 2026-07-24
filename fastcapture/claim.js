'use strict';
/**
 * Worker-side patch intake.
 *
 * Replaces the entire base64-decode / gunzip / markdown-sanitize stack with:
 *   find 12-hex receipt in chat → read byte-exact file → verify sha256 → apply
 *
 * Every sanitizer in the old pipeline existed to fight corruption that only
 * happens when bytes travel through a markdown renderer. They're gone.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

/** Pull the receipt out of the visible chat transcript. */
function findReceipt(text, regex) {
  const m = text.match(regex);
  return m ? m[1] : null;
}

/** Read + integrity-check a drop written by the ingest server. */
function claim(dropDir, receipt) {
  const metaPath = path.join(dropDir, `${receipt}.meta.json`);
  if (!fs.existsSync(metaPath)) {
    throw new Error(
      `receipt ${receipt} was announced in chat but no drop landed on disk — ` +
        `the agent sandbox probably could not reach your ingest URL`
    );
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const buf = fs.readFileSync(meta.file);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (sha !== meta.sha256) {
    throw new Error(`sha256 mismatch on ${receipt} — drop is corrupted`);
  }
  return { meta, buf };
}

/**
 * Apply a drop to the repo, commit and push.
 * Handles plain diffs and git bundles.
 */
function applyDrop({ repoRoot, dropDir, receipt, round }) {
  const { meta, buf } = claim(dropDir, receipt);
  const sh = (c) => execSync(c, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });

  // Idempotency: the receipt is a sha256 prefix, so re-uploading identical
  // work yields the same receipt. Never apply the same drop twice.
  const already = execSync('git log --oneline -n 50', { cwd: repoRoot })
    .toString()
    .includes(receipt);
  if (already) {
    return { ok: true, mode: 'skipped', bytes: buf.length, note: 'already applied' };
  }

  if (meta.kind === 'bundle') {
    // Strongest path: real git history transfer. No diff-context fuzz,
    // binary-safe, carries commit messages and authorship.
    const bundlePath = path.join(repoRoot, `.drop-${receipt}.bundle`);
    fs.writeFileSync(bundlePath, buf);
    try {
      sh(`git bundle verify "${bundlePath}"`);
      sh(`git fetch "${bundlePath}" agentwork:agentwork-${receipt}`);
      sh(`git merge --ff-only agentwork-${receipt}`);
      sh('git push');
      return { ok: true, mode: 'bundle', bytes: buf.length };
    } finally {
      fs.rmSync(bundlePath, { force: true });
    }
  }

  // The rollback below is `git reset --hard`, so refuse to run if there is
  // uncommitted work we'd destroy. Drop files themselves don't count — they
  // live in dropDir and are gitignored in a normal setup.
  const relDrop = path.relative(repoRoot, dropDir).split(path.sep).join('/');
  const dirty = execSync('git status --porcelain', { cwd: repoRoot })
    .toString()
    .split('\n')
    .filter((l) => l.trim())
    // porcelain format is 'XY <path>' — keep the prefix intact when matching
    .filter((l) => !(relDrop && l.slice(3).startsWith(relDrop)))
    .join('\n');
  if (dirty) {
    throw new Error(
      `working tree is dirty — commit or stash first:\n      ${dirty
        .split('\n')
        .slice(0, 5)
        .join('\n      ')}`
    );
  }

  const patchFile = path.join(repoRoot, `.drop-${receipt}.patch`);
  fs.writeFileSync(patchFile, buf);

  // Restore the tree to HEAD. Handles unmerged paths, which `git checkout --`
  // cannot. Safe because we verified the tree was clean above.
  const rollback = () => {
    try {
      sh('git reset -q --hard HEAD');
      // -e keeps the drop dir: those payloads are our audit trail, and
      // deleting them would discard the very patch we're debugging.
      sh(`git clean -qfd${relDrop ? ` -e "${relDrop}"` : ''}`);
    } catch {}
  };

  let mode = 'patch';
  try {
    // --binary so images/fixtures survive; --3way only as a fallback.
    try {
      sh(`git apply --binary --check "${patchFile}"`);
      sh(`git apply --binary "${patchFile}"`);
    } catch (firstErr) {
      try {
        sh(`git apply --binary --3way "${patchFile}"`);
        mode = 'patch(3way)';
      } catch (threeWayErr) {
        // CRITICAL: --3way can fail *after* writing conflict markers into the
        // tree. Committing here would push "<<<<<<< ours" into the repo.
        // Roll the working tree back and surface the real reason.
        const stderr =
          (threeWayErr.stderr && threeWayErr.stderr.toString()) || threeWayErr.message;
        rollback();
        fs.rmSync(patchFile, { force: true });
        throw new Error(
          `patch did not apply cleanly (working tree restored).\n` +
            `      ${stderr.trim().split('\n').join('\n      ')}\n` +
            `      Usually means the agent diffed against a stale base — ` +
            `pull/rebase and re-run the round.`
        );
      }
    }

    // Belt and braces: never commit conflict markers, even if git exited 0.
    const conflicted = execSync('git diff --name-only --diff-filter=U', {
      cwd: repoRoot,
    })
      .toString()
      .trim();
    if (conflicted) {
      rollback();
      throw new Error(`unresolved conflicts in: ${conflicted.split('\n').join(', ')}`);
    }

    sh('git add -A');
    sh(`git commit -m "agent: round ${round} (${receipt})"`);
    sh('git push');
    return { ok: true, mode, bytes: buf.length };
  } finally {
    fs.rmSync(patchFile, { force: true });
  }
}

module.exports = { findReceipt, claim, applyDrop };
