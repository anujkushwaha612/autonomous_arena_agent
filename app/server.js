'use strict';
/**
 * server.js — HTTP layer for Linkly.
 *
 * Exports:
 *   createServer() — returns an http.Server (does not listen).
 *   sendJson(res, status, obj) — JSON response helper.
 *
 * Run directly (`node server.js`) it listens on process.env.PORT || 3000.
 * All routing logic lives in router.js; this file only handles HTTP concerns
 * (body parsing, size limits, JSON responses) and registers routes.
 */

const http = require('http');
const { addRoute, route, sendJson } = require('./router');
const store = require('./store');
const links = require('./links');

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB
const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

let routesRegistered = false;

/** Build an absolute short URL from the request Host header + a code. */
function buildShortUrl(req, code) {
  const host = (req && req.headers && req.headers.host) || '';
  if (host) return `http://${host}/${code}`;
  return `/${code}`;
}

/** Send a redirect with no body (used by GET /:code). */
function sendRedirect(res, status, location) {
  res.writeHead(status, { Location: location, 'Content-Length': '0' });
  res.end();
}

function registerRoutes() {
  if (routesRegistered) return;
  routesRegistered = true;

  // Storage must exist before any route can serve a request (T2).
  store.init();

  addRoute('GET', '/api/health', (req, res) => {
    sendJson(res, 200, { status: 'ok', uptime: Math.floor(process.uptime()) });
  });

  // --- T3: links CRUD ---

  // Create a link. Returns 201 with the link + an absolute shortUrl.
  addRoute('POST', '/api/links', (req, res) => {
    const body = req.body || {};
    let link;
    try {
      link = links.createLink({ url: body.url, alias: body.alias });
    } catch (err) {
      switch (err.code) {
        case 'INVALID_URL':
          return sendJson(res, 400, { error: 'Invalid URL' });
        case 'INVALID_ALIAS':
          return sendJson(res, 400, { error: 'Invalid alias' });
        case 'ALIAS_TAKEN':
          return sendJson(res, 409, { error: 'Alias already in use' });
        default:
          console.error('[links] create failed:', err.message);
          return sendJson(res, 500, { error: 'Internal server error' });
      }
    }
    sendJson(res, 201, {
      code: link.code,
      url: link.url,
      shortUrl: buildShortUrl(req, link.code),
      createdAt: link.createdAt,
    });
  });

  // List all links (newest first).
  addRoute('GET', '/api/links', (req, res) => {
    const all = links.listLinks();
    sendJson(res, 200, { links: all, total: all.length });
  });

  // Fetch one link by code.
  addRoute('GET', '/api/links/:code', (req, res) => {
    const link = links.getLink(req.params.code);
    if (!link) return sendJson(res, 404, { error: 'Not found' });
    sendJson(res, 200, link);
  });

  // Delete one link by code. 204 with no body, or 404.
  addRoute('DELETE', '/api/links/:code', (req, res) => {
    const removed = links.deleteLink(req.params.code);
    if (!removed) return sendJson(res, 404, { error: 'Not found' });
    res.writeHead(204, { 'Content-Length': '0' });
    res.end();
  });

  // Public redirect. Reserved codes never resolve to a link, so they 404
  // rather than shadow the matching one-segment routes.
  addRoute('GET', '/:code', (req, res) => {
    const code = req.params.code;
    if (links.isReserved(code)) {
      return sendJson(res, 404, { error: 'Not found' });
    }
    const link = links.getLink(code);
    if (!link) return sendJson(res, 404, { error: 'Not found' });
    sendRedirect(res, 302, link.url);
  });
}

/**
 * Collect the request body. Resolves with a Buffer, or `null` when the
 * response has already been handled here (oversized body → 413, or a
 * socket error) and the caller must stop processing.
 */
function readBody(req, res) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let done = false;

    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };

    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Respond, then drain-and-close politely so the client actually
        // receives the 413 (destroying the socket can reset mid-response).
        res.setHeader('Connection', 'close');
        sendJson(res, 413, { error: 'Payload too large' });
        req.resume();
        finish(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish(Buffer.concat(chunks)));
    req.on('error', (err) => {
      console.error('[server] request stream error:', err.message);
      finish(null);
    });
  });
}

async function onRequest(req, res) {
  req.params = {};
  req.query = {};
  req.body = undefined;

  if (METHODS_WITH_BODY.has((req.method || 'GET').toUpperCase())) {
    const buf = await readBody(req, res);
    if (buf === null) return; // 413 already sent, or connection died
    if (buf.length > 0) {
      try {
        req.body = JSON.parse(buf.toString('utf8'));
      } catch {
        return sendJson(res, 400, { error: 'Invalid JSON body' });
      }
    } else {
      req.body = {};
    }
  }

  route(req, res);
}

function createServer() {
  registerRoutes();
  return http.createServer((req, res) => {
    onRequest(req, res).catch((err) => {
      console.error(`[server] unhandled error ${req.method} ${req.url}:`, err);
      sendJson(res, 500, { error: 'Internal server error' });
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const server = createServer();
  server.listen(port, () => {
    console.log(`[linkly] listening on http://0.0.0.0:${port}`);
  });
}

module.exports = { createServer, sendJson };
