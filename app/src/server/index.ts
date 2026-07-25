import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '../../public');
const portValue = Number(process.env.PORT ?? '3000');
const port = Number.isFinite(portValue) && portValue > 0 ? portValue : 3000;

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function sendJson(response: any, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function staticFilePath(urlPath: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  const requested = decoded === '/' ? '/index.html' : decoded;
  const candidate = path.resolve(publicDir, `.${requested}`);
  return candidate === publicDir || candidate.startsWith(`${publicDir}${path.sep}`) ? candidate : null;
}

const server = http.createServer((request: any, response: any) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { status: 'ok', rooms: 0, uptime: process.uptime() });
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }
  const file = staticFilePath(url.pathname);
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  const body = fs.readFileSync(file);
  response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(file)] ?? 'application/octet-stream' });
  response.end(request.method === 'HEAD' ? undefined : body);
});

const sockets = new WebSocketServer({ server });
sockets.on('connection', (socket: any) => {
  socket.on('error', () => undefined);
});

server.listen(port, () => console.log(`Impostor listening on http://localhost:${port}`));
