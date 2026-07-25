# AgentChain — Linkly, a URL shortener & analytics API

The **task brain**. Each agent completes exactly ONE task, then hands off.

> Protocol lives in `AGENT_PROMPT.md` (the worker pastes it into Arena each round).
> Summary: clone → read this file + `NEXT.md` → do the first unfinished task →
> flip it to `DONE` → upload the patch via curl → print `%%%RECEIPT:xxxxxxxxxxxx%%%`.

**Never paste a diff or base64 into chat.** The patch is uploaded out-of-band.

---

## 1. What we are building

**Linkly** — a URL shortener with click analytics, served as a JSON REST API
with a small web UI. Think Bitly, minus the account system's complexity.

By the end it will:

- shorten a long URL to a short code, and redirect on visit
- support custom aliases, expiry dates, and click limits
- record every click (timestamp, referrer, user-agent) and report analytics
- protect write endpoints with API keys, and rate-limit abusive callers
- list/search/paginate links, export data as JSON and CSV
- expose a single-page dashboard and a `/metrics` endpoint

## 2. Hard technical constraints

These are not suggestions. Breaking them breaks the pipeline.

1. **Node.js standard library ONLY.** No `express`, no `ws`, no `uuid`, no
   `bcrypt`. `app/package.json` must have an empty `dependencies` object.
   Native modules (`crypto`, `http`, `fs`, `url`, `path`) are all you need.
   *Reason: every added dependency is an install that can fail on a different
   machine and silently break every later task.*
2. **`npm start` must boot the server** and it must listen on
   `process.env.PORT || 3000`. The test runner boots your app this way.
3. **All state is JSON files under `app/data/`.** Write atomically: write to
   `<file>.tmp` then `fs.renameSync`. Never leave a half-written file.
4. **Never break an earlier task.** Endpoints and JSON field names defined by a
   completed task are a frozen contract. You may *add* fields; you may not
   rename or remove them.
5. **Every function you call must exist.** If you write
   `store.getLink(code)` in `server.js`, you must implement and export
   `getLink` in `store.js` **in the same patch**. A missing export crashes the
   app at runtime even though every file parses, and the worker will reject it.
6. **Every response is JSON** (`Content-Type: application/json`) except the
   redirect (302) and the HTML dashboard. Errors use
   `{ "error": "<human readable message>" }` with a correct HTTP status.
7. **No secrets in code.** Read anything sensitive from `process.env`.

## 3. Module contract

Keep these boundaries. `server.js` handles HTTP only and delegates all logic.

| File | Must export | Introduced by |
|---|---|---|
| `app/server.js` | `createServer()` returning an `http.Server` | T1 |
| `app/router.js` | `route(req, res)`, `addRoute(method, pattern, handler)` | T1 |
| `app/store.js` | `read(name)`, `write(name, data)`, `init()` | T2 |
| `app/links.js` | `createLink`, `getLink`, `listLinks`, `deleteLink` | T3 |
| `app/validate.js` | `isValidUrl`, `isValidAlias`, `normalizeUrl` | T4 |
| `app/analytics.js` | `recordClick`, `getStats`, `getTopLinks` | T5 |
| `app/expiry.js` | `isExpired`, `pruneExpired` | T6 |
| `app/auth.js` | `createKey`, `verifyKey`, `requireKey` | T7 |
| `app/ratelimit.js` | `check`, `reset` | T8 |
| `app/search.js` | `searchLinks`, `paginate` | T9 |
| `app/export.js` | `toJson`, `toCsv` | T10 |
| `app/metrics.js` | `snapshot`, `increment` | T12 |

## 4. Testing — mandatory, not optional

Every task adds **one** file: `app/tests/<name>.test.js`.

```js
// app/tests/example.test.js
module.exports = async (t) => {
  const res = await t.post('/api/links', { url: 'https://example.com' });
  t.assert.equal(res.status, 201, 'should create a link');
  t.assert.truthy(res.json.code, 'response must include a code');
};
```

The server is **already running** — do not start it yourself. Available on `t`:

- `t.get(path, headers)`, `t.post(path, body, headers)`, `t.put(...)`, `t.del(...)`
- `t.request(method, path, body, headers)` → `{ status, json, text }`
- `t.assert(cond, msg)`, `t.assert.equal(a, b, msg)`, `t.assert.truthy(v, msg)`
- `t.sleep(ms)`, `t.baseUrl`, `t.appRequire(name)`

Rules for tests:

- Must be **deterministic and independent** — generate unique URLs/aliases with
  `Date.now()`; never depend on another test having run first.
- Must **fail loudly** — assert on real values, not just `status < 500`.
- Keep under ~40 lines.
- Run the whole suite before handing off: `node fastcapture/smoke.js`.
  **Every test must pass**, including tests written by earlier tasks. If you
  broke an earlier test, you broke their feature — fix it before handing off.

---

## Task list

### T1: HTTP server & router foundation
**STATUS: DONE**

The skeleton everything else plugs into.

**Requirements**

- `app/package.json` — name `linkly`, `"start": "node server.js"`,
  `"dependencies": {}`.
- `app/router.js` — a tiny router with no dependencies:
  - `addRoute(method, pattern, handler)` where pattern may contain params,
    e.g. `'/api/links/:code'`
  - `route(req, res)` matches method + path, extracts params onto `req.params`,
    parses the query string onto `req.query`, and calls the handler.
  - Unmatched route → `404` with `{ "error": "Not found" }`.
  - Handler that throws → `500` with `{ "error": "Internal server error" }`
    (log the real error server-side; never leak a stack trace to the client).
- `app/server.js`:
  - exports `createServer()` returning an `http.Server`
  - JSON body parsing for POST/PUT (reject bodies over 1 MB with `413`)
  - a `sendJson(res, status, obj)` helper
  - `GET /api/health` → `200` `{ "status": "ok", "uptime": <seconds> }`
  - when run directly (`require.main === module`) it listens on
    `process.env.PORT || 3000` and logs the address

**Test** — `app/tests/health.test.js`: `GET /api/health` returns 200 and
`status === 'ok'`; an unknown path returns 404 with an `error` field.

---

### T2: JSON storage layer
**STATUS: DONE**

Durable persistence used by every later task.

**Requirements**

- `app/store.js`:
  - `init()` — create `app/data/` and any missing files with sane defaults
  - `read(name)` — read `app/data/<name>.json`, returning the default if absent
    or corrupt (never throw)
  - `write(name, data)` — **atomic**: write `<name>.json.tmp`, then rename
  - an in-memory cache so repeated reads don't hit disk every request, kept
    consistent on write
- Defaults: `links` → `{}`, `clicks` → `{}`, `keys` → `{}`
- `app/data/.gitkeep` so the directory exists in git
- `app/server.js` calls `store.init()` on startup
- Add `app/data/*.json` to the repo `.gitignore` (keep `.gitkeep`)

**Test** — `app/tests/store.test.js`: use `t.appRequire` to load `store.js`
directly; write a value, read it back, confirm it round-trips; confirm reading
an unknown name returns the default instead of throwing.

---

### T3: Create links & redirect
**STATUS: DONE**

The core product.

**Requirements**

- `app/links.js`:
  - `createLink({ url, alias })` → `{ code, url, createdAt, clicks: 0 }`
  - `getLink(code)` → the link or `null`
  - `listLinks()` → array of all links, newest first
  - `deleteLink(code)` → `true` if deleted, `false` if it didn't exist
  - codes are 7 chars from `[A-Za-z0-9]`, generated with `crypto.randomBytes`,
    and must not collide with an existing code
- Endpoints:
  - `POST /api/links` body `{ url, alias? }` → `201`
    `{ code, url, shortUrl, createdAt }` where `shortUrl` is the absolute URL
    built from the request `Host` header
  - `GET /api/links` → `200` `{ links: [...], total: <n> }`
  - `GET /api/links/:code` → `200` the link, or `404`
  - `DELETE /api/links/:code` → `204`, or `404`
  - `GET /:code` → `302` redirect to the target URL, or `404` JSON if unknown
- Reserve `api`, `health`, `metrics` as codes so they never shadow a route.

**Test** — `app/tests/links.test.js`: create a link, fetch it by code, follow
`GET /:code` and assert a 302 with the correct `Location` header, delete it,
then confirm it 404s.

---

### T4: URL validation & custom aliases
**STATUS: TODO**

Stop garbage getting in.

**Requirements**

- `app/validate.js`:
  - `isValidUrl(str)` — must parse via `new URL()`, and scheme must be
    `http:` or `https:`. Reject `javascript:`, `data:`, `file:`.
  - `normalizeUrl(str)` — trim, add `https://` if no scheme, strip a trailing
    slash on a bare host, lowercase the hostname
  - `isValidAlias(str)` — 3–32 chars, `[a-zA-Z0-9_-]` only, not a reserved word
- Wire into `POST /api/links`:
  - invalid URL → `400` `{ "error": "Invalid URL" }`
  - invalid alias → `400` `{ "error": "Invalid alias" }`
  - alias already taken → `409` `{ "error": "Alias already in use" }`
  - a valid alias becomes the code
- Store the normalized URL, not the raw input.

**Test** — `app/tests/validate.test.js`: assert `400` for `not-a-url` and for
`javascript:alert(1)`; create a link with a unique custom alias and confirm the
returned `code` matches it; creating the same alias twice returns `409`.

---

### T5: Click analytics
**STATUS: TODO**

Record and report every visit.

**Requirements**

- `app/analytics.js`:
  - `recordClick(code, { referrer, userAgent, ip })` — append a click record
    with an ISO `timestamp`; also increment the link's `clicks` counter
  - `getStats(code)` → `{ total, byDay: { 'YYYY-MM-DD': n }, topReferrers: [...],
    recent: [...last 10] }`
  - `getTopLinks(limit = 10)` → most-clicked links, descending
- `GET /:code` calls `recordClick` **before** redirecting, and must still
  redirect even if recording fails (never break the redirect for analytics).
- Endpoints:
  - `GET /api/links/:code/stats` → `200` the stats object, `404` if unknown
  - `GET /api/stats/top?limit=n` → `200` `{ links: [...] }`
- Truncate stored user-agent strings to 200 chars. Never store a full IP —
  store only the first two octets (e.g. `203.0.x.x`) for privacy.

**Test** — `app/tests/analytics.test.js`: create a link, hit `GET /:code` three
times, then assert `stats.total === 3` and that `byDay` has today's date.

---

### T6: Expiry & click limits
**STATUS: TODO**

Links that die on schedule.

**Requirements**

- `app/expiry.js`:
  - `isExpired(link)` — true if `expiresAt` is in the past, or `maxClicks` is
    set and `clicks >= maxClicks`
  - `pruneExpired()` — delete all expired links, return the number removed
- `POST /api/links` accepts optional `expiresAt` (ISO date string) and
  `maxClicks` (positive integer); validate both, `400` on malformed values.
- `GET /:code` on an expired link → `410 Gone` with
  `{ "error": "This link has expired" }` (410, not 404 — the distinction
  matters to callers).
- `POST /api/admin/prune` → `200` `{ "removed": n }`
- Run `pruneExpired()` once on startup.

**Test** — `app/tests/expiry.test.js`: create a link with `maxClicks: 1`, visit
it once successfully, then assert the second visit returns `410`.

---

### T7: API keys
**STATUS: TODO**

Protect the write endpoints.

**Requirements**

- `app/auth.js`:
  - `createKey(label)` → `{ key, label, createdAt }` where `key` is 32 hex chars
    from `crypto.randomBytes`
  - `verifyKey(key)` → the key record or `null`; **use
    `crypto.timingSafeEqual`** for the comparison, not `===`
  - `requireKey(req, res)` → `true` if the request carries a valid
    `X-API-Key` header, otherwise sends `401`
    `{ "error": "Valid X-API-Key header required" }` and returns `false`
- Protect `POST /api/links`, `DELETE /api/links/:code`, and
  `POST /api/admin/prune`. **Leave `GET /:code`, `GET /api/health` and the
  stats endpoints public** — the redirect must never require a key.
- `POST /api/keys` creates a key. Bootstrap: if no keys exist yet, allow the
  first call unauthenticated; afterwards it requires an existing key.
- Never log a full key. Log at most the first 8 characters.

**Test** — `app/tests/auth.test.js`: create a key, assert `POST /api/links`
without a key returns `401`, and with the key returns `201`. Confirm
`GET /api/health` still works with no key.

---

### T8: Rate limiting
**STATUS: TODO**

Cheap in-memory abuse protection.

**Requirements**

- `app/ratelimit.js`:
  - `check(identifier, { limit, windowMs })` →
    `{ allowed: boolean, remaining: number, resetAt: <ms epoch> }`
  - sliding window kept in memory (a `Map`); evict expired entries so it can't
    grow without bound
  - `reset(identifier)` clears one entry (tests need this)
- Apply to all `/api/*` routes: 100 requests per minute, keyed by API key when
  present, otherwise by remote address.
- Over the limit → `429` `{ "error": "Rate limit exceeded" }`.
- Every `/api/*` response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`
  and `X-RateLimit-Reset` headers.
- The redirect route `GET /:code` is **not** rate limited.

**Test** — `app/tests/ratelimit.test.js`: use `t.appRequire('../ratelimit')` to
test the module directly — call `check` past its limit with a small custom
window and assert `allowed` flips to `false`, then that `reset()` restores it.
Also assert `X-RateLimit-Remaining` is present on a normal API response.

---

### T9: Search, filter & pagination
**STATUS: TODO**

Make a large link list usable.

**Requirements**

- `app/search.js`:
  - `searchLinks(query, opts)` — case-insensitive substring match over `url`
    and `code`; `opts` supports `{ createdAfter, createdBefore, minClicks }`
  - `paginate(items, { page = 1, perPage = 20 })` →
    `{ items, page, perPage, total, totalPages }`
- `GET /api/links` gains `?q=`, `?page=`, `?perPage=` (max 100),
  `?sort=` (`created` | `clicks`) and `?order=` (`asc` | `desc`).
- Response becomes
  `{ links: [...], page, perPage, total, totalPages }` —
  **keep `links` and `total` as-is** so T3's test still passes.
- Invalid pagination params (`page=0`, `perPage=abc`) → `400`.

**Test** — `app/tests/search.test.js`: create three links with a shared unique
token in their URLs, search for that token, and assert exactly three results
and correct `total`/`totalPages`.

---

### T10: Bulk operations & export
**STATUS: TODO**

Get data in and out.

**Requirements**

- `app/export.js`:
  - `toJson(links)` → pretty-printed JSON string
  - `toCsv(links)` → CSV with header row `code,url,clicks,createdAt,expiresAt`,
    correctly quoting fields containing commas or quotes
- Endpoints (all require an API key):
  - `POST /api/links/bulk` body `{ urls: [...] }` (max 100) → `201`
    `{ created: [...], failed: [{ url, error }] }` — partial success is fine
    and must not abort the whole batch
  - `GET /api/export?format=json|csv` → the file with correct
    `Content-Type` and a `Content-Disposition: attachment` header
  - `DELETE /api/links/bulk` body `{ codes: [...] }` → `{ deleted: n }`

**Test** — `app/tests/export.test.js`: bulk-create two valid URLs plus one
invalid one, assert `created.length === 2` and `failed.length === 1`, then
`GET /api/export?format=csv` and assert the response starts with the header row.

---

### T11: Web dashboard
**STATUS: TODO**

A usable front end, no build step.

**Requirements**

- `app/public/index.html` — single self-contained page (inline CSS + JS, no
  CDN links, no frameworks):
  - form to shorten a URL, with optional alias / expiry / max-clicks
  - result shows the short URL with a copy button
  - table of existing links: code, target, clicks, created, delete button
  - search box wired to `?q=`, plus pagination controls
  - click a row to see its stats
  - stores the API key in `localStorage`, sends it as `X-API-Key`
  - shows friendly error messages, never a raw stack trace
- Serve it from `GET /` in `server.js`, and static files from `app/public/`.
  Guard against path traversal (`../`) when serving static files.
- Must work with JavaScript from the same origin only — no external requests.

**Test** — `app/tests/ui.test.js`: `GET /` returns 200, `Content-Type` contains
`text/html`, and the body contains `<form`. Assert `GET /../server.js` does
**not** return the source file.

---

### T12: Metrics & observability
**STATUS: TODO**

Make it operable.

**Requirements**

- `app/metrics.js`:
  - `increment(name, by = 1)` and `snapshot()` → all counters plus
    `{ uptime, memoryMb, startedAt }`
  - counters: `http_requests_total`, `redirects_total`, `errors_total`,
    `links_created_total`, `rate_limited_total`
- `GET /metrics` → `200` plain-text Prometheus exposition format
  (`# HELP`, `# TYPE`, then `name value` lines). No API key required.
- `GET /api/health` extends to
  `{ status, uptime, version, links: <count>, checks: { storage: 'ok' } }` —
  **keep the existing `status` and `uptime` fields** so T1's test still passes.
- Structured request logging to stdout: one JSON line per request with
  `method`, `path`, `status`, `durationMs`. Never log API keys or full IPs.

**Test** — `app/tests/metrics.test.js`: hit `/api/health`, then `GET /metrics`
and assert the body contains `http_requests_total` and that its value is a
number greater than zero.

---

## Activity Log

<!-- Agents append one line here per completed task -->
- 2026-07-25 T1 DONE — HTTP server & router foundation: `app/package.json` (linkly, stdlib-only), `app/router.js` (addRoute/route/sendJson, params + query, 404/500 JSON), `app/server.js` (createServer, 1 MB body cap → 413, JSON parsing → 400, `/api/health`, PORT||3000), `app/tests/health.test.js`. Smoke suite: 1 passed, 0 failed.
- 2026-07-25 T2 DONE — JSON storage layer: `app/store.js` (`init`/`read`/`write` + `clearCache`/`dataDir`/`filePath`/`names`, atomic `.tmp`→`renameSync`, mtime-aware in-memory cache, never throws on missing/corrupt files, defaults links/clicks/keys → `{}`), `app/data/.gitkeep`, `store.init()` wired into `server.js`, `app/data/*.json` gitignored, `app/tests/store.test.js`. Smoke suite: 2 passed, 0 failed.
- 2026-07-25 T3 DONE — Create links & redirect: `app/links.js` (`createLink`/`getLink`/`listLinks`/`deleteLink` + `generateCode`/`RESERVED_CODES`/`isReserved`/`isReservedCode`/`CODE_LENGTH`; 7-char `[A-Za-z0-9]` codes via `crypto.randomBytes` with collision+reserved retry; links persisted as `{ [code]: {code,url,createdAt,clicks} }` via store). Endpoints in `server.js`: `POST /api/links`→201 `{code,url,shortUrl,createdAt}` (Host-derived shortUrl), `GET /api/links`→`{links,total}`, `GET /api/links/:code`→200/404, `DELETE /api/links/:code`→204/404, `GET /:code`→302 Location (reserved codes `api`/`health`/`metrics` never resolve→404). `app/tests/links.test.js`. Smoke suite: 3 passed, 0 failed.
