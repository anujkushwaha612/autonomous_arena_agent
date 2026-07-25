T8 is complete. Message reactions are now fully supported with emoji picker and real-time updates.

**What landed**
- `app/storage.js` — Added `findMessageById(messageId)`, `addReaction(messageId, username, emoji)`, and `removeReaction(messageId, username, emoji)`. Message structure extended with `reactions: { '👍': ['user1', 'user2'] }`. All changes atomically persisted.
- `app/server.js` — Added `POST /messages/:id/react` (body: `{ emoji }`) and `DELETE /messages/:id/react/:emoji` authenticated endpoints. Both broadcast the updated message via `broadcastToRoom` as `{ type: 'reaction', message }`. WebSocket handler also accepts `{ type: 'reaction', messageId, emoji, action: 'add'|'remove' }` for low-latency reactions.
- `app/client.html` — Added hover-reveal reaction button (😊) on each message, emoji picker popup with 👍 ❤️ 😂 🎉 👀, reaction pills below messages showing emoji + count, click-to-toggle (adds if absent, removes if present), and `.mine` highlight class for own reactions. Client handles `reaction` WebSocket events to update DOM in real time.

**Verified:**
- Server starts and listens on port 3000.
- `npm install` succeeds.
- Storage `addReaction`/`removeReaction`/`findMessageById` unit-tested and working.

**Next task is T9: Message Replies (Threading)** — update `app/storage.js` with `replyToMessage` and `getReplies`; update `app/server.js` with `POST /messages/:id/reply` and `GET /messages/:id/replies`; update `app/client.html` with reply button, thread expansion, indented replies, and reply input.
