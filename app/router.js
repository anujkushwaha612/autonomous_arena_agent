'use strict';
/**
 * router.js — a tiny zero-dependency HTTP router.
 *
 * Exports:
 *   addRoute(method, pattern, handler) — register a route. `pattern` may
 *     contain named params, e.g. '/api/links/:code'.
 *   route(req, res) — match req.method + path, attach req.params / req.query,
 *     and invoke the handler. Unmatched → 404 JSON; throwing handler → 500 JSON.
 *   sendJson(res, status, obj) — JSON response helper (re-exported by server.js).
 */

const routes = [];

function sendJson(res, status, obj) {
  if (res.headersSent || res.writableEnded) {
    if (!res.writableEnded) res.end();
    return;
  }
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Split a path into non-empty segments ('/a//b/' → ['a', 'b']). */
function splitPath(pathname) {
  return String(pathname).split('/').filter((s) => s.length > 0);
}

function addRoute(method, pattern, handler) {
  if (typeof method !== 'string' || !method) throw new TypeError('method must be a string');
  if (typeof pattern !== 'string' || !pattern) throw new TypeError('pattern must be a string');
  if (typeof handler !== 'function') throw new TypeError('handler must be a function');

  const segments = splitPath(pattern).map((part) =>
    part.startsWith(':') && part.length > 1
      ? { param: true, name: part.slice(1) }
      : { param: false, value: part }
  );

  const entry = { method: method.toUpperCase(), pattern, segments, handler };
  routes.push(entry);
  return entry;
}

function matchRoute(method, pathname) {
  const parts = splitPath(pathname);
  for (const entry of routes) {
    if (entry.method !== method) continue;
    if (entry.segments.length !== parts.length) continue;

    const params = {};
    let matched = true;
    for (let i = 0; i < entry.segments.length; i++) {
      const seg = entry.segments[i];
      if (seg.param) {
        try {
          params[seg.name] = decodeURIComponent(parts[i]);
        } catch {
          params[seg.name] = parts[i];
        }
      } else if (seg.value !== parts[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { entry, params };
  }
  return null;
}

function parseQuery(search) {
  const query = {};
  const params = new URLSearchParams(search);
  for (const [key, value] of params) query[key] = value;
  return query;
}

function route(req, res) {
  const method = (req.method || 'GET').toUpperCase();
  const rawUrl = req.url || '/';
  const qIndex = rawUrl.indexOf('?');
  const pathname = qIndex === -1 ? rawUrl : rawUrl.slice(0, qIndex);
  const query = qIndex === -1 ? {} : parseQuery(rawUrl.slice(qIndex + 1));

  req.query = query;

  const found = matchRoute(method, pathname);
  if (!found) {
    return sendJson(res, 404, { error: 'Not found' });
  }

  req.params = found.params;

  let result;
  try {
    result = found.entry.handler(req, res);
  } catch (err) {
    console.error(`[router] handler error ${method} ${pathname}:`, err);
    return sendJson(res, 500, { error: 'Internal server error' });
  }

  // Support async handlers: surface rejections as a 500 JSON response.
  if (result && typeof result.then === 'function') {
    result.catch((err) => {
      console.error(`[router] async handler error ${method} ${pathname}:`, err);
      sendJson(res, 500, { error: 'Internal server error' });
    });
  }
  return result;
}

module.exports = { addRoute, route, sendJson };
