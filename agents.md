# AgentChain — RepLog, a gym & strength-training tracker

The **task brain**. Each agent completes exactly **one** task, then hands off.

> Protocol lives in `AGENT_PROMPT.md` (the worker pastes it into Arena each round).
> Summary: clone → read this file + `NEXT.md` → do the first unfinished task →
> flip it to `DONE` → upload the patch via curl → print `%%%RECEIPT:xxxxxxxxxxxx%%%`.

**Never paste a diff or base64 into chat.** The patch is uploaded out-of-band.

---

## Repository layout — READ THIS BEFORE TOUCHING ANYTHING

This repository is **not** the product. It is an autonomous build pipeline that
*contains* the product. Two things live side by side:

```
<repo root>
├── worker.js            ← PIPELINE. Never edit, never delete.
├── config.js            ← PIPELINE
├── package.json         ← PIPELINE's package.json. NOT the product's.
├── fastcapture/         ← PIPELINE
├── scripts/             ← PIPELINE
├── agents.md            ← this file (you flip your task's STATUS)
├── NEXT.md              ← handoff notes (you rewrite this)
└── app/                 ← THE PRODUCT. Everything you build goes here.
```

**All product code lives under `app/`.** The only files you may modify outside
`app/` are `agents.md` and `NEXT.md`.

When a task says "add a script" or "add a config file", that means inside
`app/` — `app/package.json`, `app/.env.example`, and so on. **Never create or
overwrite `package.json` at the repository root**: it belongs to the worker, and
replacing it breaks the pipeline that is running you.

### If you are the first agent

`app/` will not exist yet. That is expected and is not an error:

```bash
mkdir -p app
```

Build your task inside it. Do not scaffold later tasks, do not create empty
placeholder folders, and do not "tidy" the pipeline files.

### The task list is complete as written

Every task that will ever exist is already listed below. A missing higher number
means the plan ends there — it is not an invitation to invent, renumber, split
or merge tasks. Unfamiliar files in the repository root are pipeline machinery,
not leftovers: nothing here needs resetting, cleaning or reorganising.

**Do exactly one task. Change nothing else.**

---

## Product direction

RepLog is a self-hostable strength-training tracker: fast enough to use
one-handed at a rack, rigorous enough to analyse training over years.

### Stack — deliberately boring

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere, `strict: true` |
| Backend | Express 4 + Node 20 |
| Database | **MongoDB** with Mongoose ODM |
| Frontend | React 18 + Vite + TypeScript |
| Styling | Tailwind CSS |
| Validation | Zod, shared between client and server |
| Charts | Recharts |
| Tests | Vitest (unit) + the pipeline smoke runner (integration) |
| Lint | ESLint + Prettier |

**No monorepo tooling.** No pnpm workspaces, no Turborepo, no Nx, no Docker
required for development. Two folders, one `package.json`, npm scripts.

### Project shape

```
app/
├── package.json          # ONE package.json for the whole product
├── .env.example
├── tsconfig.json
├── src/
│   ├── server/           # Express API
│   │   ├── index.ts      # entry point
│   │   ├── db.ts         # mongoose connection
│   │   ├── models/       # mongoose schemas
│   │   ├── routes/       # express routers
│   │   ├── services/     # business logic (no req/res in here)
│   │   └── middleware/
│   ├── client/           # React app (Vite root)
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── pages/
│   │   ├── components/
│   │   └── lib/
│   └── shared/           # Zod schemas + types used by BOTH sides
└── tests/                # pipeline smoke tests (*.test.js)
```

### Cross-platform scripts — this WILL bite you

The pipeline runs on Windows. `"start": "NODE_ENV=production node ..."` fails
there with *'NODE_ENV' is not recognized as an internal or external command*,
and every task after yours fails with it.

- **Never put `VAR=value` inline in an npm script.** Use the `cross-env`
  dependency, or read the variable in code with a default.
- Prefer `node` over shell built-ins in scripts. No `&&` chains that rely on a
  POSIX shell, no `rm -rf`, no `cp`. Use `rimraf`/`cpy`, or a small Node script.
- Use forward slashes in paths inside config; Node normalises them everywhere.

### The two commands that must always work

```bash
npm run dev     # API + Vite dev server together, one command
npm start       # production: build client, serve everything on ONE port
```

- `npm run dev` runs both via `concurrently`. API on `:3000`, Vite on `:5173`
  with a proxy for `/api` so there is no CORS dance.
- `npm start` **must serve the built React app and the API from a single port**
  (`process.env.PORT || 3000`). The pipeline's test runner boots exactly this
  command and waits for that one port — if `npm start` needs two ports or a
  separate build step, every later task fails.

### Database rules

1. **Connection string comes from `process.env.MONGODB_URI`.** Never hard-code
   it, never commit a real one.
2. **If `MONGODB_URI` is unset, fall back to `mongodb-memory-server`** and log a
   clear warning. This is what makes the app testable on a machine with no
   MongoDB installed — including the pipeline's own test runner. This fallback
   is required, not optional.
3. Every model gets explicit `timestamps: true`, and indexes on any field used
   for lookup or sort.
4. Mongo `_id` is exposed to clients as `id` (string). Never leak `__v`.
5. Use a transaction (or a single atomic update) whenever two documents must
   change together. Never leave orphaned sets behind a deleted session.

### Non-negotiable engineering rules

1. **TypeScript, `strict: true`.** No `any` without a comment explaining why.
2. **Never commit secrets.** Add new configuration to `.env.example` with
   placeholder values.
3. **Validate at the boundary.** Every request body and query string is parsed
   with a Zod schema from `src/shared/`. Invalid input returns `400` before any
   business logic runs.
4. **Stable error envelope**, always: `{ "error": { "code", "message", "details?" } }`
   with a correct HTTP status. Never leak a stack trace to a client.
5. **All API routes are under `/api/v1`.** Once a route or JSON field name ships
   in a completed task it is frozen — you may add fields, never rename or remove.
6. **Timestamps stored in UTC** as ISO-8601. Weights stored in **kilograms** as
   numbers. Display units are a user preference, converted at the edge only.
7. **No business logic in route handlers or React components.** Routes parse,
   call a service, and serialize. Services own the rules and are unit-testable.
8. **Every function you call must exist.** If you write `sessionService.finish()`
   in a route, implement and export `finish` in the same patch. A missing export
   crashes at runtime even though the file compiles, and the worker rejects it.
9. **Accessibility is not a later task.** Semantic HTML, labelled inputs, visible
   focus, ≥44px touch targets, WCAG AA contrast.
10. **Never break an earlier task.** Run the whole test suite before handing off.

### Core domain

```ts
User    = { id, email, name, timezone, units: 'kg'|'lb', weekStart, createdAt }
Exercise = { id, name, slug, muscleGroup, equipment, instructions,
             aliases: string[], isCustom, ownerId|null, archived }
Session = { id, userId, startedAt, finishedAt|null, notes, timezone,
            routineId|null, status: 'active'|'completed'|'cancelled' }
Set     = { id, sessionId, exerciseId, order, kind, weightKg, reps,
            rpe|null, isWarmup, loggedAt }
Routine = { id, userId, name, exercises: [{ exerciseId, targetSets,
            targetReps, targetRpe|null, restSeconds }], archived }
BodyMetric = { id, userId, date, weightKg, waistCm?, bodyFatPct?, restingHr? }
```

- `muscleGroup` ∈ `chest|back|legs|shoulders|arms|core|fullBody`
- `equipment` ∈ `barbell|dumbbell|machine|cable|bodyweight|kettlebell|other`
- `kind` ∈ `warmup|working|drop|amrap|failure`
- `rpe` is 1–10 or null

---

## Testing — mandatory, not optional

Every behavioural task adds **one** file: `app/tests/<name>.test.js`.

```js
// app/tests/example.test.js
module.exports = async (t) => {
  const res = await t.post('/api/v1/sessions', {});
  t.assert.equal(res.status, 201, 'should start a session');
  t.assert.truthy(res.json.id, 'response must include an id');
};
```

The server is **already running** — do not start it yourself. Available on `t`:

- `t.get(path, headers)`, `t.post(path, body, headers)`, `t.put(...)`, `t.del(...)`
- `t.request(method, path, body, headers)` → `{ status, headers, json, text }`
- `t.assert(cond, msg)`, `t.assert.equal(a, b, msg)`, `t.assert.truthy(v, msg)`
- `t.sleep(ms)`, `t.baseUrl`, `t.appRequire(name)`

Rules:

- **Deterministic and independent.** Create your own data; never depend on
  another test having run. Make names unique with `Date.now()`.
- **Assert real values**, not just `status < 500`.
- Keep under ~40 lines.
- Before handing off run `node fastcapture/smoke.js` from the repo root.
  **Every test must pass**, including tests written by earlier tasks. If you
  broke one, you broke their feature — fix it before you upload.

---

## Task list

### T1: Project skeleton, Express server & MongoDB connection
**STATUS: TODO**

The foundation. Deliberately the largest task because nothing else can start.

**Requirements**

- `app/package.json` — name `replog`, and exactly these scripts:
  - `"dev": "concurrently \"npm:dev:server\" \"npm:dev:client\""`
  - `"dev:server"`, `"dev:client"`
  - `"build"` (typecheck + vite build), `"start"` (serve built client + API on one port)
  - `"test"` (vitest), `"lint"`, `"typecheck"`
- `app/tsconfig.json` with `strict: true`.
- `app/src/server/db.ts` — `connect()` using `process.env.MONGODB_URI`, falling
  back to `mongodb-memory-server` with a clear warning when unset. Export
  `connect()`, `disconnect()`, `isConnected()`.
- `app/src/server/index.ts` — Express app with JSON body parsing (1 MB limit),
  a request-id middleware, the standard error envelope, and a 404 handler.
  Exports `createApp()`; listens only when run directly on `PORT || 3000`.
- `GET /api/v1/health` → `200` `{ status: 'ok', uptime, db: 'connected'|'memory' }`
- In production mode, serve `app/dist/client` statically and fall through to
  `index.html` for client routes — **the same port as the API**.
- `app/.env.example` documenting `MONGODB_URI`, `PORT`, `NODE_ENV`.
- Minimal `app/src/client/` (Vite entry + a "RepLog" heading) so `npm start` works.
- `app/.gitignore` for `node_modules/`, `dist/`, `.env`.

**Test** — `app/tests/health.test.js`: health returns 200 with `status === 'ok'`
and a numeric `uptime`; an unknown `/api/v1/nope` returns 404 with an
`error.code`.

---

### T2: Error handling, logging & config validation
**STATUS: TODO**

Make failures legible before there is anything complex to fail.

**Requirements**

- `app/src/server/middleware/errors.ts` — an `AppError` class carrying
  `{ code, status, message, details? }`, plus the central error middleware that
  serializes the standard envelope. Unknown errors become `500 INTERNAL` and are
  logged with the request id, never returned verbatim.
- `app/src/server/middleware/logger.ts` — one structured JSON line per request:
  `{ ts, level, requestId, method, path, status, durationMs }`. Redact
  `authorization`, `cookie`, `password`, `token` anywhere in logged objects.
- `app/src/server/config.ts` — parse `process.env` through a Zod schema at
  startup, with defaults and clear failure messages. Exit non-zero on invalid
  config rather than starting half-broken.
- `asyncHandler` wrapper so a rejected promise in any route reaches the error
  middleware.

**Test** — `app/tests/errors.test.js`: a deliberately failing route (or an
unknown route) returns the envelope shape `{ error: { code, message } }`, and
the response contains no stack trace.

---

### T3: Exercise model, seed catalogue & search API
**STATUS: TODO**

You cannot log a set without something to log against.

**Requirements**

- `app/src/server/models/Exercise.ts` — Mongoose schema for the shape in Core
  domain. Unique index on `slug`. Text index on `name` and `aliases`.
- `app/src/server/services/exerciseService.ts` —
  `seedDefaults()` (idempotent — safe on every boot), `list({ q, muscleGroup,
  equipment, page, limit })`, `getById`, `getBySlug`.
- Seed **at least 60** real exercises across all seven muscle groups and all
  equipment types, each with 1–3 sentences of instructions and useful aliases
  (e.g. "Barbell Back Squat" ← `squat`, `back squat`).
- Routes: `GET /api/v1/exercises` (search + filter + pagination, max `limit`
  100), `GET /api/v1/exercises/:id`.
- Response: `{ data: [...], page, limit, total, totalPages }`.

**Test** — `app/tests/exercises.test.js`: the seeded list is non-empty;
`?muscleGroup=legs` returns only leg exercises; `?q=squat` finds the back squat;
`?limit=500` is rejected with `400`.

---

### T4: Custom exercises
**STATUS: TODO**

**Requirements**

- `createExercise`, `updateExercise`, `archiveExercise`, `restoreExercise` in
  the exercise service. Custom exercises set `isCustom: true` and an `ownerId`.
- **Curated (non-custom) exercises are immutable** — attempting to edit or
  archive one returns `403 IMMUTABLE_EXERCISE`.
- Slug is generated from the name and must be unique; a duplicate returns
  `409 DUPLICATE_EXERCISE`.
- Archived exercises are hidden from the default list but returned with
  `?includeArchived=true`, and remain resolvable by id so old sets still render.
- Routes: `POST /api/v1/exercises`, `PATCH /api/v1/exercises/:id`,
  `POST /api/v1/exercises/:id/archive`, `POST /api/v1/exercises/:id/restore`.

**Test** — `app/tests/custom-exercises.test.js`: create a custom exercise with a
unique name; creating it twice returns 409; editing a seeded curated exercise
returns 403; an archived exercise disappears from the default list.

---

### T5: Training sessions
**STATUS: TODO**

**Requirements**

- `app/src/server/models/Session.ts` with an index on `{ userId, startedAt: -1 }`.
- `sessionService`: `start({ notes, timezone, routineId })`, `finish(id)`,
  `cancel(id)`, `get(id)` (with sets embedded — empty until T6), `list({ page,
  limit, from, to })`, `remove(id)`.
- **Only one active session at a time** — starting a second returns
  `409 SESSION_ALREADY_ACTIVE`.
- `finish` on an already-finished session returns `409 SESSION_NOT_ACTIVE`.
- Deleting a session deletes its sets atomically — no orphans.
- Routes: `POST /api/v1/sessions`, `GET /api/v1/sessions`,
  `GET /api/v1/sessions/active`, `GET /api/v1/sessions/:id`,
  `POST /api/v1/sessions/:id/finish`, `DELETE /api/v1/sessions/:id`.

**Test** — `app/tests/sessions.test.js`: start a session, confirm it appears at
`/active`, a second start returns 409, finish returns 200, `/active` then
returns `null`.

---

### T6: Set logging
**STATUS: TODO**

The core interaction — what you actually use at the rack.

**Requirements**

- `app/src/server/models/Set.ts`, indexed on `{ sessionId, order }` and
  `{ exerciseId, loggedAt: -1 }`.
- `setService`: `add`, `update`, `remove`, `reorder(sessionId, orderedIds)`,
  `listBySession`.
- Validation: session must exist and be **active** (`409` otherwise); exercise
  must exist (`404`); `weightKg` 0–1000; `reps` integer 1–100; `rpe` null or
  1–10; `kind` from the enum; `order` assigned server-side, never trusted.
- `GET /api/v1/sessions/:id` now embeds its sets **and** a computed
  `totalVolumeKg` = Σ(`weightKg` × `reps`) over non-warmup sets only.
- Routes: `POST /api/v1/sessions/:id/sets`, `PATCH /api/v1/sets/:id`,
  `DELETE /api/v1/sets/:id`, `POST /api/v1/sessions/:id/sets/reorder`.

**Test** — `app/tests/sets.test.js`: log 60kg×5 and 70kg×5, assert
`totalVolumeKg === 650`; a warm-up set does not change it; `reps: 0` returns 400.

---

### T7: Personal records & estimated 1RM
**STATUS: TODO**

**Requirements**

- `app/src/server/services/recordService.ts`:
  - `estimate1RM(weightKg, reps, formula = 'epley')` — Epley `w × (1 + reps/30)`,
    returning exactly `w` when `reps === 1`; also support `brzycki`. Round to 1dp.
  - `getRecords(exerciseId)` → `{ maxWeight, maxReps, best1RM, maxVolume }`,
    each pointing at the source set, computed over **non-warmup** sets only.
  - `getHistory(exerciseId, { limit })` → per-session summary
    `[{ sessionId, date, sets, topSetKg, best1RM, volumeKg }]`, newest first.
- Routes: `GET /api/v1/exercises/:id/records`,
  `GET /api/v1/exercises/:id/history`, `GET /api/v1/records`.
- An exercise with no sets returns nulls, not an error.

**Test** — `app/tests/records.test.js`: via `t.appRequire`, assert
`estimate1RM(100,1) === 100` and `estimate1RM(100,10) === 133.3`; log 100kg×5
then 110kg×3 and assert `maxWeight` is the 110kg set.

---

### T8: Progressive overload & plate calculator
**STATUS: TODO**

**Requirements**

- `progressionService.suggestNextWeight(exerciseId)` →
  `{ suggestedKg, reason, confidence, basedOn }`:
  - no history → `null` with `reason: 'no_history'`
  - all target reps hit at RPE ≤ 8 last session → advance by the equipment
    increment (barbell 2.5, dumbbell 2, machine/cable 5, bodyweight 0 → suggest
    reps instead)
  - otherwise `reason: 'repeat'`; three stalled sessions → `reason: 'deload'`
    at 90%
  - **never** guess with fewer than 2 recorded sessions
- `plateService.breakdown(targetKg, { barKg = 20, plates, collarsKg = 0 })` →
  plates **per side**, plus `achievableKg` and `remainderKg` when exact loading
  is impossible. Handle targets below bar weight gracefully.
- Routes: `GET /api/v1/exercises/:id/suggestion`,
  `GET /api/v1/plates?target=&bar=`.

**Test** — `app/tests/progression.test.js`: `breakdown(120)` gives per-side
plates summing to 50kg; a target under the bar returns an empty plate list with
a clear reason; an exercise with no history returns `reason: 'no_history'`.

---

### T9: Routines
**STATUS: TODO**

**Requirements**

- `app/src/server/models/Routine.ts` and `routineService` with `list`, `get`,
  `create`, `update`, `archive`, `startSession(routineId)`.
- `seedRoutines()` — idempotent; ship "Push", "Pull", "Legs" and
  "StrongLifts 5×5" built from seeded exercise ids.
- `startSession` creates a session with `routineId` set and **snapshots the
  prescription**, so editing the routine later never alters past sessions.
- `GET /api/v1/sessions/:id` gains `routineProgress`:
  `[{ exerciseId, name, targetSets, completedSets }]` when the session came from
  a routine.
- Validation: at least one exercise; every `exerciseId` must exist.
- Routes: `GET/POST /api/v1/routines`, `GET/PATCH /api/v1/routines/:id`,
  `POST /api/v1/routines/:id/start`.

**Test** — `app/tests/routines.test.js`: seeded routines are non-empty; starting
from a routine returns a session whose `routineId` matches and whose
`routineProgress` lists the planned exercises with `completedSets: 0`.

---

### T10: Statistics & analytics API
**STATUS: TODO**

**Requirements**

- `statsService` using **MongoDB aggregation pipelines**, not in-memory JS loops:
  - `volumeByWeek({ weeks = 12 })` → `[{ weekStart, volumeKg, sessions, sets }]`,
    ISO weeks from Monday, **including zero weeks** so charts have no gaps
  - `muscleGroupBalance({ days = 30 })` → volume, set count and percentage per
    muscle group
  - `frequency({ days = 90 })` → `{ total, perWeekAvg, byWeekday }`
  - `summary()` → `{ totalSessions, totalSets, totalVolumeKg, favouriteExercise,
    last7Days: { sessions, volumeKg } }`
- Routes under `GET /api/v1/stats/*`.
- On an empty database every endpoint returns well-formed zeroes — no `NaN`,
  no `null` where a number is promised, no crash.

**Test** — `app/tests/stats.test.js`: on a fresh database `/stats/summary`
returns numbers (not `NaN`) for every numeric field; after logging a known
session, `totalVolumeKg` increases by exactly the expected amount.

---

### T11: Body metrics & training calendar
**STATUS: TODO**

**Requirements**

- `app/src/server/models/BodyMetric.ts` — compound unique index on
  `{ userId, date }` so there is one entry per day; `date` stored as
  `YYYY-MM-DD`.
- `bodyService`: `upsert({ date, weightKg, waistCm, bodyFatPct, restingHr })`
  (later writes overwrite), `history({ days = 90 })` ascending with a **7-day
  moving average** on each point. Validate weight 20–500 kg.
- `calendarService`: `month({ year, month })` → every day of that month with
  `{ date, sessions, volumeKg }`, including empty days;
  `streak()` → `{ currentWeeks, longestWeeks, lastSessionDate }` using
  **consecutive weeks containing ≥1 completed session** — document that choice
  in the file.
- Routes: `GET/POST /api/v1/body`, `GET /api/v1/calendar?year=&month=`,
  `GET /api/v1/streak`. Invalid month → `400`.

**Test** — `app/tests/body.test.js`: posting twice for the same date leaves one
entry with the later value; `/calendar?year=2026&month=1` returns 31 entries;
`month=13` returns 400.

---

### T12: Export & import
**STATUS: TODO**

**Requirements**

- `transferService`:
  - `exportAll()` → `{ version: 1, exportedAt, exercises, sessions, sets,
    routines, bodyMetrics }`
  - `importAll(payload, { mode })` where mode is `merge` or `replace`.
    Validate with Zod; reject unknown `version` with `400`. **Atomic** — a
    payload that fails validation partway writes nothing at all. Returns
    `{ imported: {...}, skipped }`.
  - `toCsv(sets)` → header `date,exercise,weightKg,reps,rpe,kind`, quoting any
    field containing a comma, quote or newline.
- Routes: `GET /api/v1/export`, `GET /api/v1/export.csv`,
  `POST /api/v1/import?mode=`. Both exports send
  `Content-Disposition: attachment`.

**Test** — `app/tests/transfer.test.js`: export, re-import in `merge` mode, and
assert nothing is duplicated; `/export.csv` begins with the exact header row;
`{ version: 99 }` returns 400.

---

### T13: React shell, routing & design system
**STATUS: TODO**

First front-end task. Everything visual builds on this.

**Requirements**

- Vite + React 18 + TypeScript + Tailwind, dark theme by default and
  system-aware, with a manual toggle persisted to `localStorage`.
- Client routing (React Router) with five routes: Log, History, Progress, Body,
  Library. Bottom tab bar on mobile, sidebar from `md:` up.
- `src/client/lib/api.ts` — a typed fetch wrapper that unwraps the error
  envelope and throws a typed `ApiError`.
- Shared primitives in `src/client/components/ui/`: `Button`, `Input`, `Card`,
  `Dialog`, `Spinner`, `EmptyState`, `Toast`.
- A top-level error boundary and a route-level loading state.
- Accessibility: skip link, visible focus rings, ≥44px targets,
  `prefers-reduced-motion` respected.

**Test** — `app/tests/ui.test.js`: `GET /` returns 200 with `text/html`
containing `<div id="root"`; `GET /../package.json` does **not** return source
(path-traversal guard).

---

### T14: Active workout logger UI
**STATUS: TODO**

The rack-first screen. This is the product.

**Requirements**

- Start/resume/finish a session; the active session survives a page reload.
- Exercise picker with search, recents and favourites.
- Big touch-friendly weight/reps steppers (`+2.5 / -2.5`, `+1 / -1` reps),
  set-kind selector, optional RPE.
- **Optimistic updates**: a logged set appears instantly and reconciles with the
  server response; a failure rolls back visibly with a toast.
- The suggested next weight from T8 shown inline, with its reason.
- Swipe-or-button delete with undo.
- A rest timer that starts automatically after each set, with presets and an
  accessible, non-blocking completion state.

**Test** — `app/tests/logger-ui.test.js`: the served HTML for `/` includes the
client bundle, and `POST /api/v1/sessions` → `POST .../sets` → `GET` the session
returns the set the UI would render (API-level proof the flow the UI depends on
works end to end).

---

### T15: History, progress & body UI
**STATUS: TODO**

**Requirements**

- **History**: paginated session list grouped by month, expandable to sets, with
  volume summaries and a confirm-before-delete flow.
- **Progress**: Recharts views for weekly volume (bar), e1RM per exercise (line)
  and muscle-group balance (radial or bar), with a date-range control and
  genuine empty states.
- **Body**: weight entry form, trend line with the 7-day moving average, and
  unit conversion honouring the user preference.
- **Library**: browse/search exercises, filter chips, detail dialog with
  instructions, and create-custom-exercise.
- Every screen has a loading skeleton and a meaningful empty state.

**Test** — `app/tests/progress-api.test.js`: the endpoints the charts consume
(`/stats/volume`, `/stats/balance`, `/body`) all return well-formed arrays on a
fresh database rather than errors.

---

### T16: Hardening, polish & operations
**STATUS: TODO**

Final task. Make it safe to run and pleasant to operate.

**Requirements**

- `express-rate-limit` on `/api/v1/*` (120 req/min), with
  `RateLimit-*` headers; `helmet` with a sensible CSP for a same-origin SPA.
- Request body size limits, and `mongo-sanitize` (or equivalent) against
  operator injection in query objects.
- `GET /api/v1/health` extended to `{ status, uptime, version, db, counts:
  { exercises, sessions, sets } }` — **keep `status` and `uptime`** so T1's test
  still passes.
- `GET /metrics` in Prometheus text format: `http_requests_total`,
  `errors_total`, `sets_logged_total`, `sessions_started_total`.
- Graceful shutdown: stop accepting connections, close Mongoose, exit 0.
- `app/README.md` — setup, `npm run dev`, environment variables, how to point at
  a real MongoDB, and how to run the tests.

**Test** — `app/tests/hardening.test.js`: `/metrics` contains
`http_requests_total` with a numeric value; the health response still has
`status === 'ok'`; a response carries the `X-Content-Type-Options: nosniff`
header.

---

## Activity Log

<!-- Agents append one line here per completed task -->
