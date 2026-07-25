'use strict';
/**
 * validate.js — URL and custom alias validation for Linkly.
 *
 * Exports (see module contract in agents.md):
 *   isValidUrl(str)      — true only for http(s) URLs with a usable host
 *   normalizeUrl(str)    — trim, default scheme to https, lowercase host,
 *                          strip '/' from a bare host
 *   isValidAlias(str)    — 3–32 chars, [A-Za-z0-9_-], not reserved
 *
 * Node.js standard library only.
 */

const links = require('./links');

const ALIAS_RE = /^[A-Za-z0-9_-]{3,32}$/;
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const HOST_PORT_RE = /^[^/:?#]+:\d+(?:[/?#]|$)/;

function hasValidHostname(hostname) {
  if (!hostname) return false;
  if (hostname === 'localhost') return true;

  // IPv4 addresses are accepted if each octet is in range.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return hostname.split('.').every((part) => {
      const n = Number(part);
      return part !== '' && Number.isInteger(n) && n >= 0 && n <= 255;
    });
  }

  // `new URL()` leaves IPv6 hostnames bracketed in .hostname; accept the shape
  // after basic parsing and scheme checks have already succeeded.
  if (hostname.startsWith('[') && hostname.endsWith(']')) return true;

  // Avoid accepting arbitrary single words like "not-a-url" after we add the
  // default scheme; ordinary public hostnames need at least one dot.
  if (!hostname.includes('.')) return false;

  const labels = hostname.split('.');
  return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

function parseNormalized(str) {
  if (typeof str !== 'string') return null;
  const normalized = normalizeUrl(str);
  if (!normalized) return null;
  try {
    return new URL(normalized);
  } catch {
    return null;
  }
}

function isValidUrl(str) {
  const parsed = parseNormalized(str);
  if (!parsed) return false;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (!hasValidHostname(parsed.hostname.toLowerCase())) return false;
  return true;
}

function normalizeUrl(str) {
  if (typeof str !== 'string') return '';
  let input = str.trim();
  if (!input) return '';

  // Treat host:port (for example localhost:3000) as schemeless even though it
  // matches the generic URI-scheme shape. Real schemes such as javascript: are
  // left intact so validation can reject them rather than turning them into a
  // seemingly valid https URL.
  if (!SCHEME_RE.test(input) || HOST_PORT_RE.test(input)) {
    input = `https://${input}`;
  }

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return input;
  }

  parsed.hostname = parsed.hostname.toLowerCase();

  // Strip the trailing slash that URL adds for a bare host. Keep slashes that
  // are part of an actual path, or any URL with a query/hash.
  if (parsed.pathname === '/' && parsed.search === '' && parsed.hash === '') {
    const auth = parsed.username
      ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ''}@`
      : '';
    return `${parsed.protocol}//${auth}${parsed.host}`;
  }

  return parsed.toString();
}

function isValidAlias(str) {
  if (typeof str !== 'string') return false;
  if (!ALIAS_RE.test(str)) return false;
  return !links.isReserved(str);
}

module.exports = {
  isValidUrl,
  isValidAlias,
  normalizeUrl,
};
