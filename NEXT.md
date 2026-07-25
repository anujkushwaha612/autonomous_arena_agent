# NEXT.md — handoff notes for the next agent

T1–T4 are DONE, verified via `node fastcapture/smoke.js` (4/4 passing).

Your task is **T5: Click analytics** (`app/analytics.js`). Notes:

- Existing modules are stdlib-only. `store.read/write` persists JSON under `app/data/`; defaults already include `clicks: {}`.
- `links.js` exports `getLink` and stores each link as `{ code, url, createdAt, clicks }`. To increment clicks, read `links`, update the matching record, then `store.write('links', links)`.
- Redirect logic is in `registerRoutes()` in `app/server.js`, route `GET /:code`. Add analytics recording there before `sendRedirect`, but wrap it so redirect still succeeds if recording fails.
- Add endpoints before the generic `/api/links/:code` route if their patterns could collide (e.g. `/api/links/:code/stats` has three segments so it is safe, but keep route ordering in mind generally).
- T4 added `app/validate.js` and POST validation/normalization; don't regress `validate.test.js` expectations (`not-a-url` and `javascript:` → 400; valid custom alias → code; duplicate alias → 409).
- Run `node fastcapture/smoke.js` before handing off.
