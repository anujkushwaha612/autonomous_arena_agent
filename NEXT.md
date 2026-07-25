T7 is complete. Multiple chat rooms are now supported with full authentication and room-scoped messaging.

**What landed**
- `app/storage.js` — Added room management: `createRoom`, `getRooms`, `getRoom`, `joinRoom`, `leaveRoom`, `getRoomMembers`. Implemented dual persistence for `messages.json` and `rooms.json`.
- `app/server.js` — Added authenticated REST endpoints: `GET /rooms`, `POST /rooms`, `POST /rooms/:id/join`, `POST /rooms/:id/leave`. Updated WebSocket broadcast logic to `broadcastToRoom` which only sends messages to members of the target room.
- `app/client.html` — Major update: Added Login/Register UI (integrated with T6 endpoints), room list sidebar, Create Room functionality, and room-scoped message switching/display.
- `app/data/rooms.json` — Initialized with an empty object `{}`.

**Verified:**
- Server starts and listens on port 3000.
- `app/data/rooms.json` is correctly managed.
- `npm install` run in `app/`.

**Next task is T8: Message Reactions** — update `app/storage.js` to support adding/removing reactions on messages; update `app/server.js` with `POST /messages/:id/react` and `DELETE /messages/:id/react/:emoji` endpoints and broadcast reaction updates via WebSocket; update `app/client.html` with reaction buttons, emoji picker, and reaction count displays.
