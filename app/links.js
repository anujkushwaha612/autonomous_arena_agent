'use strict';
/**
 * links.js — core link CRUD for Linkly.
 *
 * Exports (see module contract in agents.md):
 *   createLink({ url, alias }) → { code, url, createdAt, clicks: 0 }
 *   getLink(code)              → the link, or null
 *   listLinks()                → array of all links, newest first
 *   deleteLink(code)           → true if deleted, false if absent
 *
 * Also exported for tests / later tasks:
 *   generateCode(), RESERVED_CODES, isReserved(), isReservedCode()
 *
 * Storage: links are persisted by `store.js` as an object keyed by code:
 *   { [code]: { code, url, createdAt, clicks } }
 * `store` is mtime-aware + atomic, so we just read/write and let it cache.
 * Node.js standard library only.
 */

const crypto = require('crypto');
const store = require('./store');

const CODE_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LENGTH = 7;
/** Codes that must never be used as a link code so they can't shadow a route. */
const RESERVED_CODES = Object.freeze(new Set(['api', 'health', 'metrics']));

function isReserved(code) {
  return RESERVED_CODES.has(String(code || '').toLowerCase());
}

/** Alias kept for clarity in later tasks; identical to isReserved. */
function isReservedCode(code) {
  return isReserved(code);
}

/**
 * Generate a unique, non-reserved 7-char code from `[A-Za-z0-9]` using
 * `crypto.randomBytes`. Retries (with a sane cap) so a collision — or an
 * astronomically unlucky reserved word like `metrics` — can't trap us.
 */
function generateCode() {
  const links = store.read('links');
  for (let attempt = 0; attempt < 1000; attempt++) {
    const bytes = crypto.randomBytes(CODE_LENGTH);
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }
    if (!Object.prototype.hasOwnProperty.call(links, code) && !isReserved(code)) {
      return code;
    }
  }
  throw new Error('Could not generate a unique link code');
}

/**
 * Create and persist a link. Throws when:
 *   - `url` is missing/empty
 *   - `alias` is a reserved word (would shadow a route)
 *   - `alias` collides with an existing code
 * Callers map these to the appropriate HTTP status.
 */
function createLink({ url, alias } = {}) {
  if (url === undefined || url === null || String(url).trim() === '') {
    const err = new Error('Invalid URL');
    err.code = 'INVALID_URL';
    throw err;
  }

  const code = alias ? String(alias) : generateCode();

  if (isReserved(code)) {
    const err = new Error('Invalid alias');
    err.code = 'INVALID_ALIAS';
    throw err;
  }

  const links = store.read('links');
  if (Object.prototype.hasOwnProperty.call(links, code)) {
    const err = new Error('Alias already in use');
    err.code = 'ALIAS_TAKEN';
    throw err;
  }

  const link = {
    code,
    url: String(url),
    createdAt: new Date().toISOString(),
    clicks: 0,
  };
  links[code] = link;
  store.write('links', links);
  return link;
}

/** Fetch one link by code, or null when it doesn't exist. */
function getLink(code) {
  if (!code) return null;
  const links = store.read('links');
  return Object.prototype.hasOwnProperty.call(links, code) ? links[code] : null;
}

/** All links, newest first (sorted by ISO createdAt, stable for ties). */
function listLinks() {
  const links = store.read('links');
  return Object.values(links).sort((a, b) => {
    const ca = a && a.createdAt ? a.createdAt : '';
    const cb = b && b.createdAt ? b.createdAt : '';
    if (ca === cb) return 0;
    return ca < cb ? 1 : -1; // descending
  });
}

/** Delete a link by code. Returns true on removal, false if it was absent. */
function deleteLink(code) {
  if (!code) return false;
  const links = store.read('links');
  if (!Object.prototype.hasOwnProperty.call(links, code)) return false;
  delete links[code];
  store.write('links', links);
  return true;
}

module.exports = {
  createLink,
  getLink,
  listLinks,
  deleteLink,
  generateCode,
  RESERVED_CODES,
  isReserved,
  isReservedCode,
  CODE_LENGTH,
};
