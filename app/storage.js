const fs = require('fs');
const path = require('path');

const DEFAULT_ROOM = 'general';
const DEFAULT_LIMIT = 50;
const DATA_DIR = path.join(__dirname, 'data');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');

// In-memory mirror of messages.json: { roomId: [message, ...] }.
let rooms = null;

function emptyStore() {
  return { [DEFAULT_ROOM]: [] };
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** Load messages.json from disk, tolerating a missing or corrupt file. */
function load() {
  if (rooms) {
    return rooms;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
    rooms = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : emptyStore();
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`[storage] could not read ${MESSAGES_FILE}: ${error.message}; starting empty`);
    }
    rooms = emptyStore();
  }

  // Drop malformed room buckets and guarantee the default room exists.
  for (const [roomId, list] of Object.entries(rooms)) {
    if (!Array.isArray(list)) {
      delete rooms[roomId];
    }
  }
  if (!Array.isArray(rooms[DEFAULT_ROOM])) {
    rooms[DEFAULT_ROOM] = [];
  }

  return rooms;
}

/** Persist the in-memory store atomically so a crash cannot truncate the file. */
function persist() {
  ensureDataDir();
  const tempFile = `${MESSAGES_FILE}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(load(), null, 2)}\n`, 'utf8');
  fs.renameSync(tempFile, MESSAGES_FILE);
}

/**
 * Save a message to its room and flush to disk.
 * @param {object} message message with at least { id, username, content, timestamp }
 * @returns {object} the stored message (including its roomId)
 */
function saveMessage(message) {
  if (!message || typeof message !== 'object') {
    throw new TypeError('saveMessage(message): message must be an object');
  }

  const store = load();
  const roomId = typeof message.roomId === 'string' && message.roomId.trim()
    ? message.roomId.trim()
    : DEFAULT_ROOM;

  if (!Array.isArray(store[roomId])) {
    store[roomId] = [];
  }

  const stored = { ...message, roomId };
  store[roomId].push(stored);
  persist();

  return stored;
}

/**
 * Get the most recent messages for a room, oldest first.
 * @param {string} [roomId=general]
 * @param {number} [limit=50]
 */
function getMessages(roomId = DEFAULT_ROOM, limit = DEFAULT_LIMIT) {
  const store = load();
  const key = typeof roomId === 'string' && roomId.trim() ? roomId.trim() : DEFAULT_ROOM;
  const list = Array.isArray(store[key]) ? store[key] : [];
  const count = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_LIMIT;

  return list.slice(-count);
}

/** List known room ids. */
function getRoomIds() {
  return Object.keys(load());
}

/** Reset the cache and file — used by tests. */
function reset() {
  rooms = emptyStore();
  persist();
}

// Make sure data/messages.json exists with the default room on first require.
load();
if (!fs.existsSync(MESSAGES_FILE)) {
  persist();
}

module.exports = {
  DEFAULT_ROOM,
  DEFAULT_LIMIT,
  MESSAGES_FILE,
  saveMessage,
  getMessages,
  getRoomIds,
  reset,
};
