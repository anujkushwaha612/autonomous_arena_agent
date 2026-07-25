const express = require('express');
const http = require('http');
const { WebSocket, WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const storage = require('./storage');
const auth = require('./auth');

const PORT = process.env.PORT || 3000;
const HISTORY_LIMIT = storage.DEFAULT_LIMIT;

const app = express();
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'AgentChain WebSocket chat server',
    clients: clients.size,
    rooms: storage.getRoomIds(),
  });
});

// Convenience REST view of the same history the WebSocket sends on connect.
app.get('/history', (req, res) => {
  const roomId = typeof req.query.roomId === 'string' ? req.query.roomId : storage.DEFAULT_ROOM;
  const limit = Number.parseInt(req.query.limit, 10);

  res.json({
    roomId: roomId.trim() || storage.DEFAULT_ROOM,
    messages: storage.getMessages(roomId, Number.isNaN(limit) ? HISTORY_LIMIT : limit),
  });
});

// Authenticate an existing user and return a JWT.
app.post('/login', async (req, res) => {
  const body = req.body || {};
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!username || !password) {
    res.status(400).json({ success: false, error: 'Username and password are required.' });
    return;
  }

  try {
    const result = await auth.login(username, password);
    console.log(`[http] user "${username}" logged in via HTTP`);
    res.json({ success: true, token: result.token, username: result.username, expiresAt: result.expiresAt });
  } catch (error) {
    if (error.code === 'INVALID_CREDENTIALS') {
      res.status(401).json({ success: false, error: 'Invalid username or password.' });
      return;
    }
    console.error(`[auth] login failed for "${username}": ${error.message}`);
    res.status(500).json({ success: false, error: 'Could not log in. Please try again.' });
  }
});

// Create a new user account. Username: 3-20 alphanumeric chars; password: min 6 chars.
app.post('/register', async (req, res) => {
  const body = req.body || {};
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  const USERNAME_PATTERN = /^[a-zA-Z0-9]{3,20}$/;
  if (!USERNAME_PATTERN.test(username)) {
    res.status(400).json({
      success: false,
      error: 'Username must be 3-20 alphanumeric characters.',
    });
    return;
  }

  if (typeof password !== 'string' || password.length < 6) {
    res.status(400).json({
      success: false,
      error: 'Password must be at least 6 characters long.',
    });
    return;
  }

  if (auth.userExists(username)) {
    res.status(409).json({ success: false, error: `Username "${username}" is already taken.` });
    return;
  }

  try {
    const user = await auth.register(username, password);
    console.log(`[http] registered user "${username}"`);
    res.status(201).json({
      success: true,
      user: { username: user.username, joinedAt: user.joinedAt },
    });
  } catch (error) {
    if (error.code === 'USERNAME_TAKEN') {
      res.status(409).json({ success: false, error: `Username "${username}" is already taken.` });
      return;
    }
    console.error(`[auth] registration failed for "${username}": ${error.message}`);
    res.status(500).json({ success: false, error: 'Could not register user. Please try again.' });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({
  server,
  // Verify the upgrade request has a valid ?token= query param.
  verifyClient(info) {
    const url = new URL(info.req.url, `http://${info.req.headers.host}`);
    const rawToken = url.searchParams.get('token');

    if (!rawToken) {
      console.warn(`[ws] upgrade rejected — missing ?token= param from ${info.req.socket.remoteAddress}`);
      return false;
    }

    const payload = auth.verifyToken(rawToken);
    if (!payload) {
      console.warn(`[ws] upgrade rejected — invalid/expired token from ${info.req.socket.remoteAddress}`);
      return false;
    }

    // Attach the decoded payload to the incoming req so the connection handler can use it.
    info.req.authUser = payload;
    return true;
  },
});

// Tracks active WebSocket clients by server-assigned UUID.
const clients = new Map();

function heartbeat() {
  this.isAlive = true;
}

function clientSummary(client) {
  return `${client.id} (${client.remoteAddress || 'unknown address'})`;
}

function sendJson(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function broadcastJson(payload) {
  for (const client of clients.values()) {
    sendJson(client.socket, payload);
  }
}

function parseIncomingMessage(rawMessage) {
  try {
    return JSON.parse(rawMessage.toString());
  } catch (_error) {
    return null;
  }
}

function resolveRoomId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : storage.DEFAULT_ROOM;
}

function normalizeChatMessage(payload) {
  if (!payload || payload.type !== 'message') {
    return null;
  }

  const content = typeof payload.content === 'string' ? payload.content.trim() : '';
  const username = typeof payload.username === 'string' ? payload.username.trim() : '';

  if (!content || !username) {
    return null;
  }

  return {
    type: 'message',
    id: uuidv4(),
    roomId: resolveRoomId(payload.roomId),
    username,
    content,
    timestamp: new Date().toISOString(),
  };
}

function sendHistory(socket, roomId, limit = HISTORY_LIMIT) {
  const room = resolveRoomId(roomId);
  const messages = storage.getMessages(room, limit);

  sendJson(socket, { type: 'history', roomId: room, messages });
  return messages;
}

wss.on('connection', (socket, req) => {
  const id = uuidv4();
  // authUser was attached by verifyClient when the upgrade was accepted.
  const authUser = req.authUser || null;
  const client = {
    id,
    socket,
    connectedAt: new Date().toISOString(),
    remoteAddress: req.socket.remoteAddress,
    authUser,
  };

  socket.isAlive = true;
  socket.on('pong', heartbeat);
  clients.set(id, client);

  console.log(`[ws] connected: ${clientSummary(client)}; total=${clients.size}`);

  sendJson(socket, {
    type: 'welcome',
    clientId: id,
    connectedAt: client.connectedAt,
    defaultRoom: storage.DEFAULT_ROOM,
    username: authUser ? authUser.username : null,
  });

  // New connections immediately receive recent history for the default room.
  const history = sendHistory(socket, storage.DEFAULT_ROOM);
  console.log(`[ws] sent ${history.length} history message(s) to ${clientSummary(client)}`);

  socket.on('message', (rawMessage) => {
    const payload = parseIncomingMessage(rawMessage);

    if (payload && payload.type === 'getHistory') {
      const limit = Number.parseInt(payload.limit, 10);
      const sent = sendHistory(
        socket,
        payload.roomId,
        Number.isNaN(limit) ? HISTORY_LIMIT : limit,
      );
      console.log(
        `[ws] getHistory from ${clientSummary(client)}: returned ${sent.length} message(s)`,
      );
      return;
    }

    const message = normalizeChatMessage(payload);

    if (!message) {
      sendJson(socket, {
        type: 'error',
        error: 'Invalid message. Expected { type: "message", content: "...", username: "..." }',
      });
      return;
    }

    let stored;
    try {
      stored = storage.saveMessage(message);
    } catch (error) {
      console.error(`[storage] failed to save message ${message.id}: ${error.message}`);
      sendJson(socket, { type: 'error', error: 'Could not save message. Please try again.' });
      return;
    }

    console.log(
      `[ws] message ${stored.id} from ${stored.username} in #${stored.roomId} (${clientSummary(client)}): ${stored.content}`,
    );
    broadcastJson(stored);
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
