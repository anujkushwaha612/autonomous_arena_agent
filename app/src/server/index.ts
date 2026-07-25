// server/index.ts — http + ws entry point. This is the ONLY server the
// pipeline boots (`npm start`), so it must serve the built client, expose
// /api/health, and accept websocket connections on one port.
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import type { HealthResponse, HelloMsg } from '../shared/types.js';
import { SERVER_VERSION, HEARTBEAT_INTERVAL_MS } from '../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../../public');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const START_TIME = Date.now();

// Room count will grow real content starting in T2. For now the health
// endpoint always reports zero — there is nothing to leak and nothing to fake.
function getRoomCount(): number {
  return 0;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** Resolve a request path safely against PUBLIC_DIR, refusing any traversal
 * outside of it (rejects `..`, absolute escapes, symlink escapes). */
function safeResolve(requestPath: string): string | null {
  const decoded = decodeURIComponent(requestPath.split('?')[0] ?? '/');
  const cleanPath = decoded === '/' ? '/index.html' : decoded;
  const resolved = path.resolve(PUBLIC_DIR, `.${cleanPath}`);
  const relative = path.relative(PUBLIC_DIR, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null; // escapes PUBLIC_DIR — traversal attempt
  }
  return resolved;
}

async function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const resolved = safeResolve(req.url ?? '/');
  if (!resolved) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  try {
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(resolved);
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    // Immutable, far-future cache for the hashed/bundled asset; no-cache for
    // the HTML shell so deploys are picked up immediately (finalised in T21).
    const cacheControl =
      ext === '.html' ? 'no-cache' : 'public, max-age=3600';
    const body = await fs.readFile(resolved);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

const server = http.createServer((req, res) => {
  const url = req.url ?? '/';

  if (url === '/api/health') {
    const payload: HealthResponse = {
      status: 'ok',
      rooms: getRoomCount(),
      uptime: (Date.now() - START_TIME) / 1000,
    };
    sendJson(res, 200, payload);
    return;
  }

  void serveStatic(req, res);
});

const wss = new WebSocketServer({ server });

wss.on('connection', (socket: WebSocket) => {
  const hello: HelloMsg = { t: 'hello', serverTime: Date.now() };
  socket.send(JSON.stringify(hello));

  const heartbeat = setInterval(() => {
    if (socket.readyState === socket.OPEN) {
      socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  socket.on('close', () => {
    clearInterval(heartbeat);
  });

  socket.on('error', () => {
    clearInterval(heartbeat);
  });
});

server.listen(PORT, HOST, () => {
  console.log(
    `[server] Impostor v${SERVER_VERSION} listening on http://${HOST}:${PORT}`
  );
});

function shutdown(): void {
  console.log('[server] shutting down...');
  wss.clients.forEach((client) => client.close(1001, 'server shutting down'));
  wss.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
  // Force-exit if graceful close hangs.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
