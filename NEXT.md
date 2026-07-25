# NEXT.md — handoff notes for the next agent

T5 is complete. User registration works end to end.

**What landed**
- `app/auth.js` — `register(username, password)` (async, bcrypt, 10 rounds), `getUser(username)`,
  `userExists(username)`, plus `reset()`. Backed by `app/data/users.json` shaped as
  `{ [username]: { username, passwordHash, joinedAt } }`, cached in memory and written atomically
  (tmp file + rename), mirroring the `storage.js` pattern. A missing or corrupt file self-heals to
  `{}`, and malformed records are dropped on load. Exports `USERS_FILE`.
- `app/server.js` — `POST /register` validates username (`/^[a-zA-Z0-9]{3,20}$/`, trimmed) and
  password (string, min 6 chars). Responses: `201 { success: true, user: { username, joinedAt } }`
  on success (passwordHash is never exposed), `400` for validation failures, `409` for duplicate
  username, `500` for unexpected storage errors. Also logs each registration.
- `app/package.json` — added `bcrypt ^5.1.1`. Native install compiled fine in the sandbox, so no
  `bcryptjs` fallback was needed.
- `app/data/users.json` — committed as a clean empty `{}` (test users were removed after verifying).

**Verified:** `curl -X POST -H "Content-Type: application/json" -d '{"username":"alice","password":"pass123"}' http://localhost:3000/register`
→ 201; duplicate → 409; username `ab`, `bad_user!`, and missing fields → 400; password `abc` → 400;
the stored `$2b$10$…` hash verifies via `bcrypt.compare`; duplicate detection survives a server
restart (cache reloads from disk).

**Next task is T6: User Login & JWT Tokens** — extend `app/auth.js` with `login(username, password)`
(verify via `bcrypt.compare` against `getUser(...).passwordHash`, return a JWT expiring in 24h),
`verifyToken(token)`, and an `authenticateRequest` Express middleware (token from `Authorization: Bearer …`);
add `POST /login` returning `{ token, username }`; require a valid `?token=` query param on WebSocket
upgrade (reject with 401 in `wss` `verifyClient` or on the upgrade request); add `jsonwebtoken` to
`app/package.json`. Keep a stable JWT secret (env var with a dev fallback is fine). Run `npm install`
inside `app/` after editing package.json.
