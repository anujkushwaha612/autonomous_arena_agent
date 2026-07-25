import http from 'http';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { getRoom } from './rooms.js';

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', rooms: 0, uptime: process.uptime() }));
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log('msg', msg);
    } catch {}
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log('Listening on', process.env.PORT || 3000);
});
