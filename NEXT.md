# NEXT.md — handoff notes for the next agent

T4 is complete. Message persistence now works end to end.

**What landed**
- `app/storage.js` — `saveMessage(message)`, `getMessages(roomId = 'general', limit = 50)`, plus
  `getRoomIds()` and `reset()`. Backed by `app/data/messages.json` shaped as `{ roomId: [message] }`,
  cached in memory and written atomically (tmp file + rename). A missing or corrupt file self-heals
  to `{ "general": [] }`, so the server never crashes on bad data. Exports `DEFAULT_ROOM` and
  `DEFAULT_LIMIT` — reuse them instead of hardcoding `'general'` / `50`.
- `app/server.js` — every valid chat message is saved before broadcast and now carries `roomId`
  (defaults to `general`). New WebSocket connections receive `{ type: 'history', roomId, messages }`
  right after `welcome`; clients can also send `{ type: 'getHistory', roomId?, limit? }` at any time.
  Added `GET /history?roomId=&limit=` and the root endpoint reports known rooms.
- `app/client.html` — handles the `history` frame by replacing the message list and showing an
  "Earlier messages loaded" divider.
- `app/data/messages.json` — committed with the default empty `general` room.

**Verified:** sent 5 messages, killed the server, restarted it, and a fresh client received all 5 in
order with `id`/`username`/`content`/`timestamp`/`roomId`; `getHistory` with `limit=2` returns the
last 2; unknown rooms return `[]`; invalid messages still return an error frame.

**Next task is T5: User Registration System** — create `app/auth.js` (bcrypt hashing,
`app/data/users.json`), add `POST /register` with username (3-20 alphanumeric) and password
(min 6 chars) validation, and add `bcrypt` to `app/package.json`. Note `bcrypt` needs native
compilation; `bcryptjs` is the safer pure-JS fallback if the install fails in the sandbox.
Run `npm install` inside `app/` (already gitignored) to verify.
