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

    let raw;
    try { raw = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    // Parse requires from the RAW source (stripNoise blanks string literals,
    // which would erase the module paths we need), but match property usage
    // against the stripped source so comments/strings can't cause false hits.
    const src = stripNoise(raw);

    for (const { alias, rel: dep } of localRequires(raw)) {
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
      // One error PER missing property. Grouping them into a single string
      // breaks baseline comparison: adding a new missing prop changes the whole
      // message, so it won't match the baseline entry — and worse, a combined
      // old+new message can mask a genuinely new bug.
      const depRel = path.relative(repoRoot, depPath).split(path.sep).join('/');
      for (const prop of missing.sort()) {
        errors.push(`${rel} calls ${alias}.${prop}() but ${depRel} does not export it`);
      }
    }
  }

  return errors;
}

module.exports = { checkContracts };
