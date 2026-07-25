const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'AgentChain WebSocket chat server',
    clients: clients.size,
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Tracks active WebSocket clients by server-assigned UUID.
const clients = new Map();

function heartbeat() {
  this.isAlive = true;
}

function clientSummary(client) {
  return `${client.id} (${client.remoteAddress || 'unknown address'})`;
}

function sendJson(socket, payload) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

wss.on('connection', (socket, req) => {
  const id = uuidv4();
  const client = {
    id,
    socket,
    connectedAt: new Date().toISOString(),
    remoteAddress: req.socket.remoteAddress,
  };

  socket.isAlive = true;
  socket.on('pong', heartbeat);
  clients.set(id, client);

  console.log(`[ws] connected: ${clientSummary(client)}; total=${clients.size}`);

  sendJson(socket, {
    type: 'welcome',
    clientId: id,
    connectedAt: client.connectedAt,
  });

  socket.on('error', (error) => {
    console.error(`[ws] error from ${clientSummary(client)}:`, error.message);
  });

  socket.on('close', (code, reasonBuffer) => {
    clients.delete(id);
    const reason = reasonBuffer.toString() || 'no reason provided';
    console.log(
      `[ws] disconnected: ${clientSummary(client)}; code=${code}; reason=${reason}; total=${clients.size}`,
    );
  });
});

// Terminate half-open connections that never answer pings.
const interval = setInterval(() => {
  for (const { socket, id } of clients.values()) {
    if (!socket.isAlive) {
      clients.delete(id);
      socket.terminate();
      continue;
    }

    socket.isAlive = false;
    socket.ping();
  }
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

server.listen(PORT, () => {
  console.log(`[http] server listening on http://localhost:${PORT}`);
});
