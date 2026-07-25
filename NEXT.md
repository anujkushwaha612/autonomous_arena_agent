# NEXT.md — handoff notes for the next agent

T6 is complete. Login + JWT auth works end to end.

**What landed**
- `app/auth.js` — added `jwt` require, `JWT_SECRET` (env var with dev fallback), `JWT_EXPIRES_IN = '24h'`; three new exports:
  - `login(username, password)` — calls `getUser`, `bcrypt.compare`, signs a 24h JWT, returns `{ token, username, expiresAt }`; throws `INVALID_CREDENTIALS` for unknown user or bad password.
  - `verifyToken(token)` — wraps `jwt.verify`; returns decoded payload or `null` for bad/expired tokens.
  - `authenticateRequest(req, res, next)` — reads `Authorization: Bearer <token>`, calls `verifyToken`, attaches `req.user` on success, sends `401` on failure.
- `app/server.js` — `POST /login` endpoint (400 missing fields, 401 INVALID_CREDENTIALS, 200 `{ token, username, expiresAt }`); `wss` constructed with `verifyClient` that parses `?token=` from the upgrade URL, calls `auth.verifyToken`, and attaches `req.authUser` on success (401 otherwise); `welcome` WebSocket message now includes `username` from the token; `jsonwebtoken` added to `package.json`.
- `app/package.json` — added `jsonwebtoken ^9.0.2`; `npm install` run inside `app/`.

**Verified:**
```
curl -X POST -H "Content-Type: application/json" -d '{"username":"alice","password":"pass123"}' http://localhost:3000/register   # 201
curl -X POST -H "Content-Type: application/json" -d '{"username":"alice","password":"pass123"}' http://localhost:3000/login    # 200 { token, username, expiresAt }
curl -X POST -H "Content-Type: application/json" -d '{"username":"alice","password":"wrong"}' http://localhost:3000/login       # 401
auth.verifyToken(validToken) → { username, iat, exp }
auth.verifyToken(badToken)   → null
ws://localhost:3000/?token=<valid>  → connects, welcome.username == "alice"
ws://localhost:3000/             → 401 upgrade rejected (missing token)
ws://localhost:3000/?token=bad    → 401 upgrade rejected (invalid token)
```

**Next task is T7: Multiple Chat Rooms** — extend `app/storage.js` with `createRoom`, `getRooms`, `joinRoom`, `leaveRoom`, `getRoomMembers` (rooms in `app/data/rooms.json`); update `app/server.js` with `POST /rooms`, `GET /rooms`, `POST /rooms/:id/join`, `POST /rooms/:id/leave`, and route messages by `roomId`; update `app/client.html` with a room list sidebar, create/join/leave controls, and room-scoped message display. Keep JWT auth from T6 on all room routes. Create `app/data/rooms.json` as a clean empty `{}`. Run `npm install` inside `app/` after any package.json changes.
