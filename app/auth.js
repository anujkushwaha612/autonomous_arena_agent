const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const BCRYPT_ROUNDS = 10;
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// In-memory mirror of users.json: { [username]: { username, passwordHash, joinedAt } }.
let users = null;

function emptyStore() {
  return {};
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** Load users.json from disk, tolerating a missing or corrupt file. */
function load() {
  if (users) {
    return users;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    users = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : emptyStore();
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`[auth] could not read ${USERS_FILE}: ${error.message}; starting empty`);
    }
    users = emptyStore();
  }

  // Drop malformed user records (must have a bcrypt hash on file).
  for (const [username, record] of Object.entries(users)) {
    const valid = record
      && typeof record === 'object'
      && typeof record.passwordHash === 'string'
      && typeof record.joinedAt === 'string';
    if (!valid) {
      delete users[username];
    }
  }

  return users;
}

/** Persist the in-memory store atomically so a crash cannot truncate the file. */
function persist() {
  ensureDataDir();
  const tempFile = `${USERS_FILE}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(load(), null, 2)}\n`, 'utf8');
  fs.renameSync(tempFile, USERS_FILE);
}

/** Check whether a username is already taken. */
function userExists(username) {
  return Object.prototype.hasOwnProperty.call(load(), username);
}

/** Get a user record by username, or null if not found. */
function getUser(username) {
  const record = load()[username];
  return record ? { ...record } : null;
}

/**
 * Create a new user with a bcrypt-hashed password.
 * @param {string} username
 * @param {string} password plaintext password (already validated by the caller)
 * @returns {Promise<object>} the stored record { username, passwordHash, joinedAt }
 */
async function register(username, password) {
  const store = load();

  if (userExists(username)) {
    const error = new Error(`Username "${username}" is already taken`);
    error.code = 'USERNAME_TAKEN';
    throw error;
  }

  const record = {
    username,
    passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
    joinedAt: new Date().toISOString(),
  };

  store[username] = record;
  persist();
  console.log(`[auth] registered user "${username}"`);

  return { ...record };
}

/** Reset the cache and file — used by tests. */
function reset() {
  users = emptyStore();
  persist();
}

// Make sure data/users.json exists on first require.
load();
if (!fs.existsSync(USERS_FILE)) {
  persist();
}

module.exports = {
  USERS_FILE,
  register,
  getUser,
  userExists,
  reset,
};
