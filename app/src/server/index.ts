// server/index.ts — http + ws entry point. This is the ONLY server the
// pipeline boots (`npm start`), so it must serve the built client, expose
// /api/health, and accept websocket connections on one port.
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import type { HealthResponse, HelloMsg, ServerMsg } from '../shared/types.js';
import { createRoom, getRoom, getRoomCount, joinRoom, leaveRoom, listPlayers, roomView, type Player, type Room } from './rooms.js';
import { parse } from './protocol.js';
import { SERVER_VERSION, HEARTBEAT_INTERVAL_MS } from '../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../../public');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const START_TIME = Date.now();

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

const wss = new WebSocketServer({ server, maxPayload: 4096 });

interface Session { roomCode?: string; playerId?: string; }
const sessions = new Map<WebSocket, Session>();
let snapshotTick = 0;

function send(socket: WebSocket, message: ServerMsg): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}
function broadcast(room: Room): void {
  const players = listPlayers(room);
  snapshotTick += 1;
  for (const [socket, session] of sessions) {
    if (session.roomCode !== room.code || !session.playerId) continue;
    const self = room.players.get(session.playerId);
    if (!self) continue;
    send(socket, { t: 'snapshot', tick: snapshotTick, players, you: { ...self, role: 'crewmate', tasks: [] } });
  }
}
function detach(socket: WebSocket): void {
  const session = sessions.get(socket);
  if (!session?.roomCode || !session.playerId) return;
  const { room, promoted } = leaveRoom(session.roomCode, session.playerId);
  session.roomCode = undefined; session.playerId = undefined;
  if (room) {
    if (promoted) {
      for (const [peer, peerSession] of sessions) if (peerSession.roomCode === room.code) send(peer, { t: 'visual', kind: 'host-promoted', playerId: promoted.id, at: Date.now() });
    }
    broadcast(room);
  }
}
function attach(socket: WebSocket, room: Room, player: Player): void {
  const session = sessions.get(socket);
  if (!session) return;
  detach(socket);
  session.roomCode = room.code; session.playerId = player.id;
  send(socket, { t: 'joined', you: player.id, room: roomView(room) });
  broadcast(room);
}

wss.on('connection', (socket: WebSocket) => {
  sessions.set(socket, {});
  const hello: HelloMsg = { t: 'hello', serverTime: Date.now() };
  socket.send(JSON.stringify(hello));
  const heartbeat = setInterval(() => { if (socket.readyState === socket.OPEN) socket.ping(); }, HEARTBEAT_INTERVAL_MS);

  socket.on('message', (raw) => {
    const message = parse(raw.toString());
    if (!message) { send(socket, { t: 'error', code: 'BAD_MESSAGE', message: 'That message was not valid.' }); return; }
    if (message.t === 'create') { const { room, player } = createRoom(message.name); attach(socket, room, player); return; }
    if (message.t === 'join') {
      const result = joinRoom(message.code, message.name);
      if ('error' in result) { send(socket, { t: 'error', code: result.error, message: result.error === 'ROOM_FULL' ? 'That lobby is full.' : 'No lobby uses that code.' }); return; }
      attach(socket, result.room, result.player); return;
    }
    if (message.t === 'ready') {
      const session = sessions.get(socket); const room = session?.roomCode ? getRoom(session.roomCode) : undefined; const player = room && session?.playerId ? room.players.get(session.playerId) : undefined;
      if (!room || !player) { send(socket, { t: 'error', code: 'NOT_IN_ROOM', message: 'Join a lobby first.' }); return; }
      player.ready = message.value; room.lastActiveAt = Date.now(); broadcast(room); return;
    }
    send(socket, { t: 'error', code: 'UNAVAILABLE', message: 'That action is not available in the lobby yet.' });
  });
  socket.on('close', () => { clearInterval(heartbeat); detach(socket); sessions.delete(socket); });
  socket.on('error', () => { clearInterval(heartbeat); });
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
