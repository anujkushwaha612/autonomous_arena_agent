# NEXT.md — handoff notes for the next agent

## What I built (T1: Server skeleton, static hosting & build)

- `app/package.json` — `type: "module"`, deps: `ws`; devDeps: `esbuild`,
  `typescript`, `tsx`, plus `@types/node` and `@types/ws` (needed for
  `tsc --noEmit` to type-check Node/ws APIs under `strict: true` — these are
  type-only devDependencies, not a violation of the "four runtime deps" cap;
  they emit no code).
- `app/tsconfig.json` — strict TS, ES2022, bundler resolution.
- `app/esbuild.config.js` — bundles `src/client/main.ts` → `public/bundle.js`
  (ESM, sourcemaps always, minified unless `--watch`).
- `app/src/server/index.ts` — single http server on `PORT || 3000`, serves
  `public/` with a traversal guard (resolves against `PUBLIC_DIR`, rejects any
  path that escapes it via `path.relative`), attaches a `ws` server on the
  same port (sends a `{t:'hello'}` on connect, heartbeats via ping, cleans up
  its interval on close/error), `GET /api/health` → `{status:'ok', rooms, uptime}`,
  and SIGTERM/SIGINT graceful shutdown that closes all sockets then the server.
- `app/src/client/main.ts` — connects the socket, logs `open`, exponential
  backoff reconnect (1s→8s) with a `#conn-status` UI element reflecting
  connecting/open/reconnecting/closed, plus a canvas starfield with parallax
  depth layers and twinkle — this drives the "feel" of the landing page.
- `app/public/index.html` + `style.css` — Among Us-styled landing page: dark
  space background with the starfield canvas, big white/black-stroke
  "IMPOSTOR" wordmark, scalloped/rounded panel with inset shadow, a spinning
  crewmate rendered as inline SVG (bean body, backpack, visor, shine, ground
  shadow) used as the loading indicator, VT323 font import, disabled
  Find/Create/Join buttons stubbed for later tasks (T2 wires them up).
- `app/tests/health.test.js` — **committed per T1's requirement**: checks
  `/api/health` shape, `GET /` returns HTML, and `/../package.json` does not
  leak repo source.
- `app/.gitignore` — `node_modules/`, `public/bundle.js*`, `.env`.

## Decisions / things worth knowing

- `npm start` runs `npm run build && tsx src/server/index.ts` — one command,
  one port, as required. `npm run dev` runs esbuild watch + `tsx watch`
  concurrently via a backgrounded `&`.
- Room count in `/api/health` is hardcoded to `0` for now (`getRoomCount()`
  stub) since there is no room registry yet — T2 should replace that stub with
  a real count from `rooms.ts`, keeping the `status`/`rooms` field names frozen
  per the health test.
- No secrets needed for this task; nothing was added to `.env.example` because
  there is no `.env.example` yet and T1 introduces no credentialed feature.
- Verified end-to-end: `npm run typecheck` clean, `npm run build` produces
  `public/bundle.js`, manually curled `/api/health` and `/`, curled the
  traversal path (rejected, plain 404 body, no source leaked), connected a raw
  `ws` client and received the `hello` message, then ran
  `node fastcapture/smoke.js` from the repo root — it installs `app`'s deps,
  boots `npm start`, and runs `health.test.js` against the live server: **1
  passed, 0 failed**.

## Surprises / gotchas for the next agent

- `tsc --noEmit` fails hard without `@types/node`/`@types/ws` under
  `strict: true` (no `Buffer`, no `process`, no `node:*` module types, `ws`
  falls back to implicit `any`). Keep these two type packages when you touch
  `package.json` in later tasks — removing them will silently break
  `npm run typecheck`, which `agents.md` calls "your most important check".
- The static file server's cache headers already anticipate T21's requirement
  (`no-cache` for `.html`, longer cache for other assets) but T21 should
  tighten `bundle.js` specifically to `public, max-age=31536000, immutable`
  once it's a hashed/versioned filename — right now it shares the generic
  `public, max-age=3600` branch for all non-HTML assets, which is fine for now
  but not yet what T21 asks for verbatim.
- Next task per the table is **T2: Rooms, join/create & lobby state**.
