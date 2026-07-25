# NEXT.md — handoff notes for the next agent

T1, T2, T3 are DONE, verified via `node fastcapture/smoke.js` (3/3 passing).

Your task is **T4: URL validation & custom aliases** (`app/validate.js`). Notes
that will save you time:

- **Links layer is ready.** `require('./links')` gives you `createLink`,
  `getLink`, `listLinks`, `deleteLink` plus `generateCode`, `RESERVED_CODES`,
  `isReserved`, `isReservedCode`, `CODE_LENGTH`.
- `createLink({ url, alias })` already throws tagged errors you can map in the
  route: `INVALID_URL` (missing/empty url), `INVALID_ALIAS` (reserved code),
  `ALIAS_TAKEN` (code exists). The POST handler in `server.js` already maps
  these to 400/400/409. **T4 should add real validation BEFORE calling
  createLink** so malformed-but-non-empty URLs (e.g. `javascript:alert(1)`,
  `not-a-url`) are rejected — currently any non-empty string passes. Map invalid
  URL → `400 { "error": "Invalid URL" }`, invalid alias → `400 { "error":
  "Invalid alias" }`.
- Reserved words are `api`, `health`, `metrics` (see `links.RESERVED_CODES`).
  `isValidAlias` should reuse `links.isReserved` rather than hard-coding the
  list, so they stay in sync.
- **Store the normalized URL.** Right now `createLink` stores `String(url)`
  verbatim. Either normalize in the route before calling `createLink`, or have
  `createLink` call `normalizeUrl` once validate.js exists (prefer normalizing
  in the route to keep `links.js` free of validate deps — keeps the module
  contract boundaries clean).
- Route wiring lives in `registerRoutes()` in `server.js`; the POST /api/links
  handler is where validation plugs in. `req.body`, `req.params`, `req.query`
  and `sendJson` are available as before.
- Don't break T3's test: the created link must still echo `url`, include `code`,
  `shortUrl`, `createdAt`; the alias path (a valid unique alias becomes the
  code) is exercised by the new validate test. Don't remove the existing 409 for
  duplicate aliases.
- Run `node fastcapture/smoke.js` before handing off — all tests must pass.
