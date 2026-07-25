import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { createRoom, joinRoom, leaveRoom, listPlayers, roomCount, roomView, type Player, type Room } from './rooms.js';
import { parse } from './protocol.js';
import type { ClientMsg, ServerMsg } from '../shared/types.js';

const PORT = Number(process.env.PORT || 3000);
const publicDir = path.resolve('public');
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (pathname === '/api/health') { res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({status:'ok', rooms:roomCount(), uptime:process.uptime()})); return; }
  const full = path.resolve(publicDir, pathname === '/' ? 'index.html' : `.${pathname}`);
  if (!full.startsWith(publicDir + path.sep) && full !== path.join(publicDir, 'index.html')) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(full, (err, data) => { if (err) { res.writeHead(404); res.end('Not found'); } else { res.writeHead(200); res.end(data); } });
});
const wss = new WebSocketServer({ server });
type Connection = { socket: WebSocket; roomCode?: string; playerId?: string };
const connections = new Map<WebSocket, Connection>();
const send = (socket: WebSocket, message: ServerMsg) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
function state(room: Room): void { for (const connection of connections.values()) if (connection.roomCode === room.code && connection.playerId) { const player = room.players.get(connection.playerId); if (player) { send(connection.socket, { t:'joined', you:player.id, room:roomView(room) }); send(connection.socket, { t:'snapshot', tick:Date.now(), players:listPlayers(room), you:player }); } } }
function detach(connection: Connection): void { if (!connection.roomCode || !connection.playerId) return; const room = leaveRoom(connection.roomCode, connection.playerId); connection.roomCode = undefined; connection.playerId = undefined; if (room) state(room); }
function enter(connection: Connection, result: { room: Room; player: Player }): void { detach(connection); connection.roomCode = result.room.code; connection.playerId = result.player.id; state(result.room); }
const error = (socket: WebSocket, code: string, message: string) => send(socket, { t:'error', code, message });
function handle(connection: Connection, message: ClientMsg): void { if (message.t === 'create') { enter(connection, createRoom(message.name)); return; } if (message.t === 'join') { const result = joinRoom(message.code, message.name); if ('error' in result) error(connection.socket, result.error, result.error === 'NOT_FOUND' ? 'Room not found' : 'Room is unavailable'); else enter(connection, result); return; } error(connection.socket, 'UNSUPPORTED', 'That action is not available yet'); }
wss.on('connection', (socket) => { const connection: Connection = { socket }; connections.set(socket, connection); socket.on('message', (data) => { const message = parse(data.toString()); if (!message) { console.warn('Dropped invalid client message'); return; } handle(connection, message); }); socket.on('close', () => { detach(connection); connections.delete(socket); }); socket.on('error', () => socket.close()); });
console.log(`Server on port ${PORT}`);
server.listen(PORT);
