import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  if (req.url === '/api/health') {
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({status:'ok', rooms:0, uptime: process.uptime()}));
    return;
  }
  let filePath = 'public' + (req.url === '/' ? '/index.html' : req.url);
  const full = path.resolve(filePath);
  const publicDir = path.resolve('public');
  if (!full.startsWith(publicDir)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); }
    else { res.writeHead(200); res.end(data); }
  });
});
const wss = new WebSocketServer({ server });
console.log(`Server on port ${PORT}`);
server.listen(PORT);
