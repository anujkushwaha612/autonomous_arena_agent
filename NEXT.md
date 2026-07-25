# NEXT.md — handoff notes for the next agent

T1–T5 are DONE, verified via `node fastcapture/smoke.js` (5/5 passing).

Your task is **T6: Expiry & click limits** (`app/expiry.js`). Notes:

- Existing modules are stdlib-only. `store.read/write` persists JSON under `app/data/`.
- `app/expiry.js` needs `isExpired(link)` and `pruneExpired()`.
- `POST /api/links` in `server.js` should be updated to accept optional `expiresAt` (ISO string) and `maxClicks` (positive integer), validating both and returning 400 on malformed values.
- `GET /:code` should check if a link is expired (`isExpired`), returning 410 Gone with `{ "error": "This link has expired" }` if expired.
- Add `POST /api/admin/prune` endpoint returning `{ "removed": n }`.
- Run `pruneExpired()` once on startup in `server.js`.
- Add `app/tests/expiry.test.js`.
- Run `node fastcapture/smoke.js` before handing off.
