'use strict';
/**
 * Pluggable per-language validation.
 *
 * The pipeline's transport (patch upload, receipts, git) is language-agnostic,
 * but the QUALITY GATE was not: it only knew `node --check`, so a Python file
 * with a syntax error sailed straight through. This module makes the syntax
 * layer pluggable so the same pipeline can drive Python, Go, Rust, Ruby, TS,
 * shell, YAML, JSON — or a docs/data project with no code at all.
 *
 * Each checker declares:
 *   ext   — file extensions it owns
 *   probe — shell command proving the toolchain exists (skipped if missing)
 *   cmd   — (file) => command that exits non-zero on a syntax error
 *
 * A language whose toolchain isn't installed is SKIPPED, never failed. The
 * pipeline must not reject an agent's Go code just because the runner has no Go.
 */

const { execSync } = require('child_process');

const CHECKERS = [
  {
    name: 'javascript',
    ext: ['.js', '.cjs', '.mjs'],
    probe: 'node --version',
    cmd: (f) => `node --check "${f}"`,
  },
  {
    name: 'typescript',
    ext: ['.ts', '.tsx'],
    // Prefer a local tsc; only syntax-check, never full typecheck (too slow
    // and too noisy for a per-round gate).
    probe: 'npx --no-install tsc --version',
    cmd: (f) => `npx --no-install tsc --noEmit --skipLibCheck --allowJs false "${f}"`,
  },
  {
    name: 'python',
    ext: ['.py'],
    probe: 'python3 --version',
    cmd: (f) => `python3 -m py_compile "${f}"`,
  },
  {
    name: 'ruby',
    ext: ['.rb'],
    probe: 'ruby --version',
    cmd: (f) => `ruby -c "${f}"`,
  },
  {
    name: 'php',
    ext: ['.php'],
    probe: 'php --version',
    cmd: (f) => `php -l "${f}"`,
  },
  {
    name: 'shell',
    ext: ['.sh', '.bash'],
    probe: 'bash --version',
    cmd: (f) => `bash -n "${f}"`,
  },
  {
    name: 'go',
    ext: ['.go'],
    probe: 'gofmt --help',
    cmd: (f) => `gofmt -e "${f}"`,
  },
  {
    name: 'rust',
    ext: ['.rs'],
    probe: 'rustc --version',
    cmd: (f) => `rustc --edition 2021 --emit=metadata -o /dev/null "${f}"`,
  },
  {
    name: 'yaml',
    ext: ['.yml', '.yaml'],
    probe: 'python3 --version',
    cmd: (f) => `python3 -c "import sys,yaml;yaml.safe_load(open(sys.argv[1]))" "${f}"`,
  },
];

const probeCache = new Map();

/** Is this language's toolchain available on the runner? */
function available(checker) {
  if (probeCache.has(checker.name)) return probeCache.get(checker.name);
  let ok = false;
  try {
    execSync(checker.probe, { stdio: 'ignore', timeout: 15000 });
    ok = true;
  } catch {
    ok = false;
  }
  probeCache.set(checker.name, ok);
  return ok;
}

function checkerFor(file) {
  const lower = file.toLowerCase();
  return CHECKERS.find((c) => c.ext.some((e) => lower.endsWith(e))) || null;
}

/**
 * Syntax-check one file.
 * @returns {null | string} error text, or null if fine / unsupported / no toolchain
 */
function checkFile(absPath, relPath) {
  const checker = checkerFor(absPath);
  if (!checker) return null; // unknown type (.md, .txt, .csv…) — nothing to check
  if (!available(checker)) return null; // toolchain absent — skip, don't fail

  try {
    execSync(checker.cmd(absPath), {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
    });
    return null;
  } catch (e) {
    const raw = [
      (e.stderr && e.stderr.toString()) || '',
      (e.stdout && e.stdout.toString()) || '',
    ]
      .join('\n')
      .trim();
    const msg = raw.split('\n').filter(Boolean).slice(0, 3).join(' ').trim();
    return `${relPath}: ${msg || 'syntax check failed'}`;
  }
}

/** Which languages can actually be validated here (for diagnostics). */
function supported() {
  return CHECKERS.filter(available).map((c) => c.name);
}

module.exports = { checkFile, checkerFor, supported, CHECKERS };
