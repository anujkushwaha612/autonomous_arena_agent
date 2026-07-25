'use strict';
/**
 * Module contract check — catch "X is not a function" before it ships.
 *
 * REAL FAILURE THIS CATCHES
 * Task T7 in a live run wrote `storage.getRoomMembers(...)`, `storage.joinRoom(...)`
 * and three other calls into server.js, but never implemented them in storage.js.
 * Every file parsed fine, so the syntax gate passed and it was committed. The
 * server then crashed with `TypeError: storage.getRoomMembers is not a function`
 * on the very first chat message — and the next task built features on top.
 *
 * This is a whole-program check that a syntax parser structurally cannot do:
 * for each local `require('./x')`, collect the properties the caller uses and
 * verify the required module actually exports them.
 *
 * Deliberately conservative — it only flags a missing export when it can load
 * the module and statically see a direct `name.prop(...)` call, so it does not
 * produce false alarms on dynamic access.
 */

const fs = require('fs');
const path = require('path');

/** Strip comments and string literals so we don't match inside them. */
function stripNoise(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, '``')
    .replace(/'(?:\\[\s\S]|[^\\'])*'/g, "''")
    .replace(/"(?:\\[\s\S]|[^\\"])*"/g, '""');
}

/** Find `const NAME = require('./rel')` pairs. */
function localRequires(src) {
  const out = [];
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src))) out.push({ alias: m[1], rel: m[2] });
  return out;
}

/** Find properties used as `alias.prop` in the source. */
function usedProps(src, alias) {
  const props = new Set();
  const re = new RegExp(`\\b${alias}\\s*\\.\\s*([A-Za-z_$][\\w$]*)`, 'g');
  let m;
  while ((m = re.exec(src))) props.add(m[1]);
  return props;
}

function resolveLocal(fromFile, rel) {
  const base = path.resolve(path.dirname(fromFile), rel);
  for (const cand of [base, base + '.js', path.join(base, 'index.js')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

/**
 * @param {string} repoRoot
 * @param {string[]} files  repo-relative paths to inspect
 * @returns {string[]} human-readable problems
 */
function checkContracts(repoRoot, files) {
  const errors = [];

  for (const rel of files) {
    if (!/\.(js|cjs|mjs)$/.test(rel)) continue;
    if (/(^|\/)(node_modules|tests?)\//.test(rel)) continue;

    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) continue;

    let src;
    try { src = stripNoise(fs.readFileSync(abs, 'utf8')); } catch { continue; }

    for (const { alias, rel: dep } of localRequires(src)) {
      const depPath = resolveLocal(abs, dep);
      if (!depPath) continue;

      let mod;
      try {
        delete require.cache[require.resolve(depPath)];
        mod = require(depPath);
      } catch {
        // Module can't be loaded standalone (needs env, side effects, etc).
        // Not our job to report that here — the syntax/smoke checks will.
        continue;
      }
      if (!mod || (typeof mod !== 'object' && typeof mod !== 'function')) continue;

      const missing = [];
      for (const prop of usedProps(src, alias)) {
        if (!(prop in mod)) missing.push(prop);
      }
      if (missing.length) {
        errors.push(
          `${rel} calls ${alias}.{${missing.join(', ')}} but ${path
            .relative(repoRoot, depPath)
            .split(path.sep)
            .join('/')} does not export ${missing.length > 1 ? 'them' : 'it'}`
        );
      }
    }
  }

  return errors;
}

module.exports = { checkContracts };
