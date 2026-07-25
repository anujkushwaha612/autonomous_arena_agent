'use strict';
/**
 * store.js — durable JSON persistence for Linkly.
 *
 * Exports:
 *   init()            — create app/data/ and any missing files with sane defaults
 *   read(name)        — read app/data/<name>.json; returns the default for that
 *                       name when the file is missing or corrupt (never throws)
 *   write(name, data) — atomic write: <name>.json.tmp then fs.renameSync
 *
 * Also exported for later tasks / tests: DEFAULTS, dataDir(), filePath(),
 * clearCache(), names().
 *
 * Design notes
 * ------------
 * - Every state file lives under `app/data/`, resolved from __dirname so the
 *   process working directory is irrelevant.
 * - Writes are atomic: content is flushed to `<file>.json.tmp` and then
 *   renamed over the real file. A crash mid-write can therefore never leave a
 *   half-written JSON file behind — readers see either the old or the new one.
 * - An in-memory cache avoids hitting the disk on every request. It is kept
 *   consistent on write, and invalidated automatically when the file on disk
 *   changes underneath us (mtime + size check), so a second process (e.g. the
 *   test runner loading this module directly) still sees fresh data.
 * - Node.js standard library only.
 */

const fs = require('fs');
const path = require('path');

/** Default value per store name. A name not listed here defaults to `{}`. */
const DEFAULTS = {
  links: {},
  clicks: {},
  keys: {},
};

const DATA_DIR = path.join(__dirname, 'data');

/** name -> { value, mtimeMs, size } */
const cache = new Map();

/** Absolute path of the data directory. */
function dataDir() {
  return DATA_DIR;
}

/** Names that init() pre-creates. */
function names() {
  return Object.keys(DEFAULTS);
}

/**
 * Reject anything that isn't a plain store name, so a caller can never escape
 * the data directory with something like `../../etc/passwd`.
 */
function safeName(name) {
  const str = String(name || '');
  if (!/^[A-Za-z0-9_-]+$/.test(str)) {
    throw new TypeError(`Invalid store name: ${JSON.stringify(name)}`);
  }
  return str;
}

/** Absolute path of a store file. */
function filePath(name) {
  return path.join(DATA_DIR, `${safeName(name)}.json`);
}

/** A fresh (deep) copy of the default for `name`. */
function defaultFor(name) {
  const def = Object.prototype.hasOwnProperty.call(DEFAULTS, name) ? DEFAULTS[name] : {};
  return JSON.parse(JSON.stringify(def));
}

/** Drop one cached entry, or the whole cache when called with no argument. */
function clearCache(name) {
  if (name === undefined) cache.clear();
  else cache.delete(String(name));
}

function ensureDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    if (err && err.code !== 'EEXIST') {
      console.error('[store] could not create data dir:', err.message);
    }
  }
}

/** stat without throwing; returns null when the file is absent. */
function statOrNull(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

/**
 * Create the data directory and any missing store files, each seeded with its
 * default. Existing files are left untouched. Safe to call repeatedly.
 */
function init() {
  ensureDir();
  for (const name of Object.keys(DEFAULTS)) {
    const file = filePath(name);
    if (!fs.existsSync(file)) {
      try {
        writeFileAtomic(file, defaultFor(name));
      } catch (err) {
        console.error(`[store] could not initialise ${name}.json:`, err.message);
      }
    }
  }
  return DATA_DIR;
}

/** Serialise + atomically place `data` at `file`. Throws on real I/O failure. */
function writeFileAtomic(file, data) {
  ensureDir();
  const tmp = `${file}.tmp`;
  const json = `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(tmp, json, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    // Clean up the stray temp file so we never leave litter behind.
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/**
 * Read a store. Returns the default when the file is missing, empty or
 * corrupt — this function never throws for data reasons.
 */
function read(name) {
  const key = safeName(name);
  const file = filePath(key);
  const stat = statOrNull(file);

  const cached = cache.get(key);
  if (cached) {
    // Cache hit is only valid while the file on disk is unchanged.
    const unchanged =
      (!stat && cached.mtimeMs === null) ||
      (stat && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size);
    if (unchanged) return cached.value;
  }

  if (!stat) {
    const value = defaultFor(key);
    cache.set(key, { value, mtimeMs: null, size: 0 });
    return value;
  }

  let value;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = raw.trim() === '' ? null : JSON.parse(raw);
    value = parsed === null || parsed === undefined ? defaultFor(key) : parsed;
  } catch (err) {
    console.error(`[store] ${key}.json unreadable (${err.message}) — using default`);
    value = defaultFor(key);
  }

  cache.set(key, { value, mtimeMs: stat.mtimeMs, size: stat.size });
  return value;
}

/**
 * Atomically persist `data` and refresh the cache. Returns the written value
 * so callers can chain. Throws only if the filesystem itself fails.
 */
function write(name, data) {
  const key = safeName(name);
  const file = filePath(key);
  const value = data === undefined ? defaultFor(key) : data;

  writeFileAtomic(file, value);

  const stat = statOrNull(file);
  cache.set(key, {
    value,
    mtimeMs: stat ? stat.mtimeMs : null,
    size: stat ? stat.size : 0,
  });
  return value;
}

module.exports = {
  init,
  read,
  write,
  clearCache,
  dataDir,
  filePath,
  names,
  DEFAULTS,
};
