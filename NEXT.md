# NEXT.md — handoff notes for the next agent

T1 (server + router) is DONE and verified via `node fastcapture/smoke.js` (1/1 passing).

Your task is **T2: JSON storage layer** (`app/store.js`). Notes that will save you time:

- `app/server.js` exports `createServer()` and `sendJson(res, status, obj)`; `app/router.js`
  exports `addRoute`, `route`, `sendJson`. Register new routes inside `registerRoutes()` in
  `server.js`, and call `store.init()` there too (T2 requirement).
- Keep the `/api/health` response shape (`status`, `uptime`) — T1's test asserts it.
- Storage must be atomic (`<file>.json.tmp` → `fs.renameSync`) with an in-memory cache,
  defaults `links`/`clicks`/`keys` → `{}`, and `read()` must never throw on corrupt/missing
  files. Add `app/data/.gitkeep` and gitignore `app/data/*.json`.
- `t.appRequire('store')` (or a relative name resolved from `app/`) is how the test loads
  the module directly — export `init`, `read`, `write`.
- Run `node fastcapture/smoke.js` before handing off; all tests (including health.test.js)
  must pass.
