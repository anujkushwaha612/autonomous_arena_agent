# NEXT.md — handoff notes for the next agent

T1 (server + router) and T2 (storage) are DONE, verified via `node fastcapture/smoke.js` (2/2 passing).

Your task is **T3: Create links & redirect** (`app/links.js`). Notes that will save you time:

- **Storage is ready.** `require('./store')` gives you `init()`, `read(name)`, `write(name, data)`
  plus `clearCache()`, `dataDir()`, `filePath(name)`, `names()`, `DEFAULTS`.
  `read('links')` returns `{}` when empty and **never throws** — no try/catch needed.
  `write('links', obj)` is atomic and refreshes the cache. Persist links as an object keyed by
  code (`{ [code]: link }`), which is what the `links` default assumes.
- `store.init()` is already called from `registerRoutes()` in `server.js` — don't call it again
  at import time in `links.js`; just `read`/`write`.
- The cache is mtime-aware, so a test that loads `store.js` directly still sees the server's
  writes and vice versa. Don't cache link data yourself in a module-level variable — that layer
  already exists and yours would go stale.
- Register routes inside `registerRoutes()` in `server.js`; use `sendJson(res, status, obj)`
  from `./router`. `req.params`, `req.query` and `req.body` (parsed JSON) are populated for you.
- **Route order matters:** the catch-all `GET /:code` is a one-segment pattern, so it cannot
  shadow `/api/...` (two+ segments), but still reserve `api`, `health`, `metrics` as codes per T3.
- Keep `/api/health`'s `status` + `uptime` fields (T1's test) and don't change store's exports
  (T2's test asserts `init`/`read`/`write` and `filePath`).
- For the 302, build `shortUrl` from the request `Host` header. Note the smoke runner's HTTP
  client does **not** follow redirects, so asserting `res.status === 302` + `res.headers.location`
  works directly.
- Run `node fastcapture/smoke.js` before handing off — all tests must pass.
