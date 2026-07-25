# AgentChain — Multi-Agent Coding Pipeline

The **task brain**. Each agent completes exactly ONE task, then hands off.

> Protocol lives in `AGENT_PROMPT.md` (the worker pastes it into Arena each round).
> Summary: clone → read this file + `NEXT.md` → do the first unfinished task →
> flip it to `DONE` → upload the patch via curl → print `%%%RECEIPT:xxxxxxxxxxxx%%%`.

**Never paste a diff or base64 into chat.** The patch is uploaded out-of-band.

## Task list

### T1: WebSocket Server Foundation
**STATUS: DONE**

Build the basic WebSocket server infrastructure.

**Requirements:**
- `app/server.js` — Express server on port 3000
  - Basic Express setup
  - HTTP server creation
  - WebSocket server using `ws` package
  - Connection tracking (Map of connected clients)
  - Log connections/disconnections
- `app/package.json` with dependencies: `express`, `ws`, `uuid`

**Testing:**
- Start server: `npm start`
- Connect with WebSocket client (use browser console or wscat)
- Verify connection is logged
- Disconnect and verify disconnection is logged

**Files to create:**
- `app/server.js` (~80 lines)
- `app/package.json`

---

### T2: Basic Message Broadcasting
**STATUS: DONE**

Add message send/receive functionality.

**Requirements:**
- Update `app/server.js`:
  - Handle incoming WebSocket messages
  - Message format: `{ type: 'message', content: '...', username: '...' }`
  - Broadcast messages to all connected clients
  - Add message ID (uuid) and timestamp
  - Log sent messages

**Testing:**
- Start server
- Open 2 WebSocket clients
- Send message from client 1
- Verify client 2 receives it
- Check message has id, username, content, timestamp

**Files to modify:**
- `app/server.js` (add ~40 lines)

---

### T3: Basic Chat Client UI
**STATUS: DONE**

Create the frontend chat interface.

**Requirements:**
- `app/client.html` — Single-page chat app
  - HTML structure: header, message area, input area
  - CSS styling: clean, modern design
  - JavaScript:
    - Connect to WebSocket server
    - Prompt for username on connect
    - Display incoming messages (username + content + time)
    - Send messages from input field
    - Auto-scroll to latest message
    - Show connection status

**Testing:**
- Start server
- Open client.html in browser
- Enter username
- Open in second tab with different username
- Send messages back and forth
- Verify messages appear in both tabs

**Files to create:**
- `app/client.html` (~200 lines HTML/CSS/JS)

---

### T4: Message Storage & History
**STATUS: DONE**

Add persistent message storage.

**Requirements:**
- `app/storage.js` — Storage manager
  - `saveMessage(message)` — Save message to storage
  - `getMessages(roomId, limit?)` — Get recent messages (default: 50)
  - Store messages in `app/data/messages.json`
  - Create default "general" room
- Update `app/server.js`:
  - Save all messages to storage
  - Send message history to new connections
  - Handle `getHistory` request type

**Testing:**
- Start server, send 5 messages
- Restart server
- Connect new client
- Verify history loads (5 messages appear)
- Check messages.json file has data

**Files to create:**
- `app/storage.js` (~60 lines)
- `app/data/messages.json` (empty: `{ "general": [] }`)

**Files to modify:**
- `app/server.js` (add ~30 lines)

---

### T5: User Registration System
**STATUS: DONE**

Add user account creation.

**Requirements:**
- `app/auth.js` — Authentication utilities
  - `register(username, password)` — Create user, hash password with bcrypt
  - `getUser(username)` — Get user by username
  - `userExists(username)` — Check if username taken
  - Store users in `app/data/users.json`
  - User structure: `{ username, passwordHash, joinedAt }`
- Update `app/server.js`:
  - `POST /register` endpoint
  - Validate username (3-20 chars, alphanumeric)
  - Validate password (min 6 chars)
  - Return success/error response

**Testing:**
- Register user via curl: `curl -X POST -H "Content-Type: application/json" -d '{"username":"alice","password":"pass123"}' http://localhost:3000/register`
- Verify user in users.json
- Try registering same username again (should fail)
- Try invalid username/password (should fail)

**Files to create:**
- `app/auth.js` (~70 lines)
- `app/data/users.json` (empty: `{}`)

**Files to modify:**
- `app/server.js` (add ~40 lines)
- `app/package.json` (add `bcrypt`)

---

### T6: User Login & JWT Tokens
**STATUS: DONE**

Add authentication with JWT.

**Requirements:**
- Update `app/auth.js`:
  - `login(username, password)` — Verify credentials, return JWT token
  - `verifyToken(token)` — Verify and decode JWT
  - `authenticateRequest(req, res, next)` — Express middleware
  - Token expires in 24 hours
- Update `app/server.js`:
  - `POST /login` endpoint
  - Return `{ token, username }` on success
  - Add `authenticateRequest` middleware to protected routes
  - WebSocket connection requires valid token in query param

**Testing:**
- Register user
- Login via curl, get token
- Use token to authenticate WebSocket: `ws://localhost:3000?token=...`
- Try invalid token (should reject)
- Try expired token (should reject)

**Files to modify:**
- `app/auth.js` (add ~60 lines)
- `app/server.js` (add ~50 lines)
- `app/package.json` (add `jsonwebtoken`)

---

### T7: Multiple Chat Rooms
**STATUS: DONE**

Add support for multiple rooms.

**Requirements:**
- Update `app/storage.js`:
  - `createRoom(name, createdBy)` — Create new room
  - `getRooms()` — List all rooms
  - `joinRoom(roomId, username)` — Add user to room
  - `leaveRoom(roomId, username)` — Remove user from room
  - `getRoomMembers(roomId)` — Get room members
  - Store rooms in `app/data/rooms.json`
  - Room structure: `{ id, name, createdBy, members: [], createdAt }`
- Update `app/server.js`:
  - `POST /rooms` — Create room (authenticated)
  - `GET /rooms` — List rooms
  - `POST /rooms/:id/join` — Join room
  - `POST /rooms/:id/leave` — Leave room
  - Route messages to specific room
  - WebSocket message format: `{ type: 'message', roomId, content }`
- Update `app/client.html`:
  - Room list sidebar
  - Create room button
  - Switch between rooms
  - Show room members

**Testing:**
- Create 2 rooms
- Join both rooms with user1
- Join room1 with user2
- Send message in room1 (both users see it)
- Send message in room2 (only user1 sees it)
- Leave room1, verify no longer receive messages

**Files to modify:**
- `app/storage.js` (add ~80 lines)
- `app/server.js` (add ~70 lines)
- `app/client.html` (add ~100 lines)
- Create `app/data/rooms.json` (empty: `{}`)

---

### T8: Message Reactions
**STATUS: DONE**

Add emoji reactions to messages.

**Requirements:**
- Update `app/storage.js`:
  - `addReaction(messageId, username, emoji)` — Add reaction
  - `removeReaction(messageId, username, emoji)` — Remove reaction
  - Message structure extended: `{ ..., reactions: { '👍': ['user1', 'user2'] } }`
- Update `app/server.js`:
  - `POST /messages/:id/react` — Add reaction `{ emoji }`
  - `DELETE /messages/:id/react/:emoji` — Remove reaction
  - Broadcast reaction updates via WebSocket
- Update `app/client.html`:
  - Reaction button on message hover
  - Emoji picker (common emojis: 👍 ❤️ 😂 🎉 👀)
  - Show reaction counts below messages
  - Click to toggle your reaction
  - Highlight your reactions

**Testing:**
- Send message
- Add 👍 reaction from user1
- Add 👍 reaction from user2 (count shows 2)
- Remove user1's reaction (count shows 1)
- Add ❤️ reaction
- Verify reactions persist after page refresh

**Files to modify:**
- `app/storage.js` (add ~40 lines)
- `app/server.js` (add ~50 lines)
- `app/client.html` (add ~80 lines)

---

### T9: Message Replies (Threading)
**STATUS: TODO**

Add reply-to-message functionality.

**Requirements:**
- Update `app/storage.js`:
  - `replyToMessage(roomId, username, content, parentMessageId)` — Create reply
  - `getReplies(parentMessageId)` — Get all replies to a message
  - Message structure extended: `{ ..., parentId?, replyCount }`
- Update `app/server.js`:
  - `POST /messages/:id/reply` — Reply to message `{ content }`
  - `GET /messages/:id/replies` — Get replies
  - Broadcast reply events via WebSocket
- Update `app/client.html`:
  - Reply button on message hover
  - Show reply count badge
  - Click to expand thread
  - Indented replies display
  - Reply input field in thread view

**Testing:**
- Send message
- Reply to it (reply count shows 1)
- Add 2 more replies (count shows 3)
- Click to expand thread
- Verify all replies visible
- Reply to a reply (nested)
- Verify thread persists after refresh

**Files to modify:**
- `app/storage.js` (add ~50 lines)
- `app/server.js` (add ~40 lines)
- `app/client.html` (add ~100 lines)

---

### T10: Edit & Delete Messages
**STATUS: TODO**

Add message editing and deletion.

**Requirements:**
- Update `app/storage.js`:
  - `editMessage(messageId, username, newContent)` — Edit message (own only)
  - `deleteMessage(messageId, username)` — Delete message (own only)
  - Message structure extended: `{ ..., editedAt?, deleted: false }`
- Update `app/server.js`:
  - `PUT /messages/:id` — Edit message `{ content }`
  - `DELETE /messages/:id` — Delete message
  - Validate user owns message
  - Broadcast edit/delete events via WebSocket
- Update `app/client.html`:
  - Edit button on own messages (hover)
  - Delete button on own messages (hover)
  - Inline edit mode (textarea replaces message)
  - Show "(edited)" badge on edited messages
  - Show "Message deleted" placeholder for deleted messages
  - Confirm before delete

**Testing:**
- Send message as user1
- Edit message (verify "(edited)" appears)
- Try editing user2's message (should fail)
- Delete message (verify placeholder shows)
- Try deleting user2's message (should fail)
- Verify edits/deletes persist after refresh

**Files to modify:**
- `app/storage.js` (add ~40 lines)
- `app/server.js` (add ~50 lines)
- `app/client.html` (add ~80 lines)

---

### T11: Presence & Typing Indicators
**STATUS: TODO**

Add real-time presence tracking.

**Requirements:**
- `app/presence.js` — Presence manager
  - `setOnline(username, ws)` — Mark user online
  - `setOffline(username)` — Mark user offline
  - `setTyping(username, roomId)` — Mark typing (auto-expires 3s)
  - `getOnlineUsers(roomId)` — Get online users in room
  - `getTypingUsers(roomId)` — Get typing users in room
- Update `app/server.js`:
  - Track user online status on connect/disconnect
  - Handle `typing` WebSocket message
  - Broadcast presence updates
  - `GET /rooms/:id/presence` — Get room presence
- Update `app/client.html`:
  - Show online user count in room header
  - Show "User is typing..." indicator
  - Send typing event while typing (debounced)
  - Show green dot for online users
  - Update user list in real-time

**Testing:**
- Open 2 tabs with different users
- Verify both show as online
- Type in tab 1, verify "typing..." appears in tab 2
- Stop typing, verify indicator disappears after 3s
- Close tab 2, verify user shows as offline in tab 1

**Files to create:**
- `app/presence.js` (~80 lines)

**Files to modify:**
- `app/server.js` (add ~60 lines)
- `app/client.html` (add ~70 lines)

---

### T12: File Uploads & Message Search
**STATUS: TODO**

Add file sharing and search functionality.

**Requirements:**
- `app/uploads.js` — File upload manager
  - `uploadFile(buffer, originalName, mimeType, username)` — Save file
  - `getFile(fileId)` — Get file metadata and buffer
  - Store files in `app/uploads/` (gitignored)
  - File metadata: `{ id, originalName, size, mimeType, uploadedBy, uploadedAt }`
  - Max file size: 5MB
  - Allowed types: images (jpg, png, gif), documents (pdf, txt)
- `app/search.js` — Search manager
  - `searchMessages(roomId, query, options?)` — Search messages
  - Options: `{ limit, offset, username }`
  - Case-insensitive substring matching
- Update `app/server.js`:
  - `POST /upload` — Upload file (multipart)
  - `GET /files/:id` — Download file
  - `GET /rooms/:id/search?q=keyword` — Search messages
  - Support file attachments in messages
- Update `app/client.html`:
  - File upload button (paperclip icon)
  - Drag-and-drop upload
  - Show file previews (images as thumbnails)
  - Click to download
  - Search bar in room header
  - Search results with highlighted matches

**Testing:**
- Upload image file, verify thumbnail displays
- Upload PDF, verify download works
- Try uploading file > 5MB (should fail)
- Search for keyword, verify results highlighted
- Filter search by username
- Verify files persist after server restart

**Files to create:**
- `app/uploads.js` (~70 lines)
- `app/search.js` (~50 lines)

**Files to modify:**
- `app/server.js` (add ~80 lines)
- `app/client.html` (add ~100 lines)
- `app/package.json` (add `multer`)
- `.gitignore` (add `app/uploads/`)

## Activity Log

<!-- Agents append one line here per completed task -->
- 2026-07-25: Completed T1 WebSocket Server Foundation with Express HTTP server, ws connection tracking, lifecycle logging, and package metadata.
- 2026-07-25: Completed T2 Basic Message Broadcasting with validated incoming chat messages, UUID/timestamp enrichment, broadcast to all connected clients, and message logging.
- 2026-07-25: Completed T3 Basic Chat Client UI with a responsive WebSocket chat page, username prompt, connection status, safe message rendering, and reconnect handling.
- 2026-07-25: Completed T4 Message Storage & History with `app/storage.js` (atomic JSON persistence, default "general" room, 50-message default limit), history push on connect, `getHistory` handling plus a `GET /history` endpoint, and client-side history rendering.
- 2026-07-25: Completed T5 User Registration System with `app/auth.js` (bcrypt-hashed accounts, atomic `app/data/users.json` persistence, `register`/`getUser`/`userExists`), `POST /register` with username (3-20 alphanumeric) and password (min 6) validation, and the `bcrypt` dependency.
- 2026-07-25: Completed T6 User Login & JWT Tokens with `login(username, password)` (bcrypt.compare, 24h JWT), `verifyToken(token)`, and `authenticateRequest` Express middleware (Authorization: Bearer); `POST /login` returns `{ success, token, username, expiresAt }`; WebSocket upgrade requires valid `?token=` query param (401 on missing/invalid via `wss verifyClient`); JWT_SECRET from env with dev fallback; `jsonwebtoken` dependency added and installed.
- 2026-07-25: Completed T7 Multiple Chat Rooms with `app/storage.js` (room management, dual persistence), `app/server.js` (room REST API, room-aware WebSocket broadcasting), and `app/client.html` (login/register UI, room sidebar, room switching).
- 2026-07-25: Completed T8 Message Reactions with `app/storage.js` (`addReaction`, `removeReaction`, `findMessageById`), `app/server.js` (`POST /messages/:id/react`, `DELETE /messages/:id/react/:emoji`, WebSocket reaction handling + broadcasting), and `app/client.html` (hover reaction button, emoji picker with 👍 ❤️ 😂 🎉 👀, reaction pills with counts, toggle-tap to add/remove, own-reaction highlighting).

