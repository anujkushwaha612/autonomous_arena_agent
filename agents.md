# AgentChain — RepLog, a gym & strength-training tracker

The **task brain**. Each agent completes exactly ONE task, then hands off.

> Protocol lives in `AGENT_PROMPT.md` (the worker pastes it into Arena each round).
> Summary: clone → read this file + `NEXT.md` → do the first unfinished task →
> flip it to `DONE` → upload the patch via curl → print `%%%RECEIPT:xxxxxxxxxxxx%%%`.

**Never paste a diff or base64 into chat.** The patch is uploaded out-of-band.

---

## 1. What we are building

**RepLog** — a self-hosted gym tracker. You log workouts from your phone at the
rack, and it tells you whether you are actually getting stronger.

By the end it will:

- hold an exercise library (name, muscle group, equipment) you can extend
- record workouts: exercise → sets of `{ weight, reps, rpe }`, with rest timers
- track personal records and estimated 1-rep-max over time
- suggest your next working weight from recent performance (progressive overload)
- run routines/templates (Push-Pull-Legs, 5×5) and generate a workout from one
- chart volume, frequency and per-muscle-group balance
- show a streak calendar and body-weight log
- export everything to JSON/CSV, and import it back

## 2. Hard technical constraints

These are not suggestions. Breaking them breaks the pipeline.

1. **Node.js standard library ONLY.** No `express`, no `uuid`, no ORM, no chart
   library. `app/package.json` must keep `"dependencies": {}`.
   *Reason: every dependency is an install that can fail on a different machine
   and silently break every later task.*
2. **`npm start` must boot the server** on `process.env.PORT || 3000`.
   The test runner boots your app exactly this way.
3. **All state is JSON files under `app/data/`.** Write atomically: write to
   `<file>.tmp`, then `fs.renameSync`. Never leave a half-written file.
4. **Never break an earlier task.** Any endpoint or JSON field name shipped by a
   completed task is a frozen contract. You may *add* fields; you may not
   rename or remove them.
5. **Every function you call must exist.** If you write `store.getSets(id)` in
   `server.js`, implement and export `getSets` in `store.js` **in the same
   patch**. A missing export crashes at runtime even though every file parses,
   and the worker will reject the patch.
6. **Every response is JSON** (`Content-Type: application/json`) except the HTML
   dashboard. Errors use `{ "error": "<human readable>" }` with a correct status.
7. **Units are metric and explicit.** Weight is `kg` (float), never pounds.
   Dates are ISO `YYYY-MM-DD`. Timestamps are full ISO-8601 UTC strings.
8. **No secrets in code.** Read anything sensitive from `process.env`.

## 3. Module contract

`server.js` handles HTTP only and delegates all logic.

| File | Must export | Introduced by |
|---|---|---|
| `app/server.js` | `createServer()` returning an `http.Server` | T1 |
| `app/router.js` | `route(req, res)`, `addRoute(method, pattern, handler)` | T1 |
| `app/store.js` | `init()`, `read(name)`, `write(name, data)` | T1 |
| `app/exercises.js` | `listExercises`, `getExercise`, `createExercise`, `seedDefaults` | T2 |
| `app/workouts.js` | `startWorkout`, `finishWorkout`, `getWorkout`, `listWorkouts`, `deleteWorkout` | T3 |
| `app/sets.js` | `addSet`, `updateSet`, `deleteSet`, `getSets` | T4 |
| `app/records.js` | `estimate1RM`, `getPersonalRecords`, `getExerciseHistory` | T5 |
| `app/progression.js` | `suggestNextWeight`, `getPlateBreakdown` | T6 |
| `app/routines.js` | `listRoutines`, `createRoutine`, `startFromRoutine`, `seedRoutines` | T7 |
| `app/stats.js` | `volumeByWeek`, `muscleGroupBalance`, `workoutFrequency` | T8 |
| `app/streaks.js` | `getStreak`, `getCalendar`, `logBodyWeight`, `getBodyWeightHistory` | T9 |
| `app/transfer.js` | `exportAll`, `importAll`, `toCsv` | T10 |
| `app/public/index.html` | — (dashboard UI) | T11 |
| `app/metrics.js` | `snapshot`, `increment` | T12 |

## 4. Data shapes

Agree on these once so later tasks are not guessing.

```js
Exercise = { id, name, muscleGroup, equipment, isCustom, createdAt }
// muscleGroup ∈ chest|back|legs|shoulders|arms|core|fullBody
// equipment   ∈ barbell|dumbbell|machine|cable|bodyweight|kettlebell

Workout  = { id, startedAt, finishedAt|null, notes, routineId|null }
Set      = { id, workoutId, exerciseId, weightKg, reps, rpe|null, isWarmup, loggedAt }
Routine  = { id, name, exercises: [{ exerciseId, targetSets, targetReps }], createdAt }
BodyWeight = { date, weightKg }
```

`rpe` is Rate of Perceived Exertion, 1–10, optional.

## 5. Testing — mandatory, not optional

Every task adds **one** file: `app/tests/<name>.test.js`.

```js
// app/tests/example.test.js
module.exports = async (t) => {
  const res = await t.post('/api/workouts', {});
  t.assert.equal(res.status, 201, 'should start a workout');
  t.assert.truthy(res.json.id, 'response must include an id');
};
```

The server is **already running** — do not start it yourself. Available on `t`:

- `t.get(path, headers)`, `t.post(path, body, headers)`, `t.put(...)`, `t.del(...)`
- `t.request(method, path, body, headers)` → `{ status, headers, json, text }`
- `t.assert(cond, msg)`, `t.assert.equal(a, b, msg)`, `t.assert.truthy(v, msg)`
- `t.sleep(ms)`, `t.baseUrl`, `t.appRequire(name)`

Rules for tests:

- **Deterministic and independent.** Create your own data; never assume another
  test ran first. Make names unique with `Date.now()`.
- **Assert real values**, not just `status < 500`.
- Keep under ~40 lines.
- Before handing off run `node fastcapture/smoke.js` — **every test must pass**,
  including tests from earlier tasks. If you broke one, you broke their feature.

---

## Task list

### T1: Server, router & storage foundation
**STATUS: TODO**

The skeleton everything plugs into. This task is deliberately larger because
nothing else can start without it.

**Requirements**

- `app/package.json` — name `replog`, `"start": "node server.js"`,
  `"dependencies": {}`.
- `app/router.js`:
  - `addRoute(method, pattern, handler)`; patterns may contain params such as
    `'/api/workouts/:id'`
  - `route(req, res)` matches method + path, puts params on `req.params` and the
    parsed query string on `req.query`
  - unmatched → `404` `{ "error": "Not found" }`; a handler that throws → `500`
    `{ "error": "Internal server error" }` (log the real error server-side, never
    leak a stack trace)
  - export a `sendJson(res, status, obj)` helper
- `app/store.js`:
  - `init()` creates `app/data/` and any missing files with defaults
  - `read(name)` returns the parsed file, or the default if missing/corrupt —
    **never throws**
  - `write(name, data)` is **atomic** (`.tmp` then `renameSync`)
  - defaults: `exercises` `[]`, `workouts` `[]`, `sets` `[]`, `routines` `[]`,
    `bodyweight` `[]`
  - a small `id()` helper: 12 hex chars from `crypto.randomBytes`
- `app/server.js`:
  - `createServer()` returning an `http.Server`
  - JSON body parsing for POST/PUT; reject bodies over 1 MB with `413`, malformed
    JSON with `400`
  - calls `store.init()` on startup
  - `GET /api/health` → `200` `{ "status": "ok", "uptime": <seconds> }`
  - listens on `process.env.PORT || 3000` when run directly
- `app/data/.gitkeep`, and add `app/data/*.json` to `.gitignore`

**Test** — `app/tests/health.test.js`: `/api/health` returns 200 with
`status === 'ok'`; an unknown path returns 404 with an `error` field.

---

### T2: Exercise library
**STATUS: TODO**

You cannot log a set without something to log it against.

**Requirements**

- `app/exercises.js`:
  - `seedDefaults()` — insert ~20 common exercises **once** (idempotent: safe to
    call on every boot). Cover all muscle groups, e.g. Barbell Back Squat,
    Deadlift, Bench Press, Overhead Press, Barbell Row, Pull-Up, Dip,
    Romanian Deadlift, Leg Press, Lat Pulldown, Bicep Curl, Tricep Pushdown,
    Lateral Raise, Plank, Hip Thrust.
  - `listExercises({ muscleGroup, equipment, q })` — filter and search by name
  - `getExercise(id)` → exercise or `null`
  - `createExercise({ name, muscleGroup, equipment })` → validates the enums from
    §4, rejects a duplicate name (case-insensitive), sets `isCustom: true`
- Endpoints:
  - `GET /api/exercises` (supports `?muscleGroup=`, `?equipment=`, `?q=`)
  - `GET /api/exercises/:id` → 200 / 404
  - `POST /api/exercises` → `201`, or `400` invalid enum, or `409` duplicate name
- `server.js` calls `seedDefaults()` on startup.

**Test** — `app/tests/exercises.test.js`: the seeded list is non-empty;
filtering by `muscleGroup=legs` returns only leg exercises; creating a duplicate
name returns 409; an invalid `muscleGroup` returns 400.

---

### T3: Workout sessions
**STATUS: TODO**

A workout is a container for sets, with a start and an end.

**Requirements**

- `app/workouts.js`:
  - `startWorkout({ notes, routineId })` → new workout, `startedAt` now,
    `finishedAt: null`
  - `finishWorkout(id)` → sets `finishedAt`; `409` if already finished
  - `getWorkout(id)` → workout **with its sets embedded** (empty array for now;
    T4 fills this in)
  - `listWorkouts({ limit = 20, offset = 0 })` → newest first, plus a `total`
  - `deleteWorkout(id)` → also deletes that workout's sets (no orphans)
- Endpoints:
  - `POST /api/workouts` → 201
  - `GET /api/workouts` → `{ workouts, total }`
  - `GET /api/workouts/:id` → 200 / 404
  - `POST /api/workouts/:id/finish` → 200 / 404 / 409
  - `DELETE /api/workouts/:id` → 204 / 404
  - `GET /api/workouts/active` → the unfinished workout, or `null`
- Only **one** workout may be unfinished at a time: starting another returns
  `409` `{ "error": "A workout is already in progress" }`.

**Test** — `app/tests/workouts.test.js`: start a workout, confirm it appears at
`/api/workouts/active`, starting a second returns 409, finishing it returns 200,
and `active` then returns null.

---

### T4: Logging sets
**STATUS: TODO**

The core interaction — this is what you actually use at the rack.

**Requirements**

- `app/sets.js`:
  - `addSet({ workoutId, exerciseId, weightKg, reps, rpe, isWarmup })`
    - validates the workout exists and is **not finished** (`409` if it is)
    - validates the exercise exists (`404` if not)
    - `weightKg` ≥ 0 and ≤ 1000; `reps` an integer 1–100; `rpe` null or 1–10
    - `isWarmup` defaults to `false`
  - `updateSet(id, patch)` — same validation, only the mutable fields
  - `deleteSet(id)` → `true` / `false`
  - `getSets(workoutId)` → that workout's sets in logging order
- Endpoints:
  - `POST /api/workouts/:id/sets` → 201
  - `GET /api/workouts/:id/sets` → `{ sets, total }`
  - `PUT /api/sets/:id` → 200 / 404
  - `DELETE /api/sets/:id` → 204 / 404
- Update `getWorkout` so its embedded `sets` are now populated, and add a
  computed `totalVolumeKg` = Σ(`weightKg` × `reps`) over **non-warmup** sets.

**Test** — `app/tests/sets.test.js`: start a workout, add two sets
(60kg×5, 70kg×5), assert `totalVolumeKg === 650`, assert a warm-up set does not
change it, and assert `reps: 0` returns 400.

---

### T5: Personal records & 1RM
**STATUS: TODO**

Turn raw sets into progress you can see.

**Requirements**

- `app/records.js`:
  - `estimate1RM(weightKg, reps)` — **Epley**: `w × (1 + reps/30)`, and exactly
    `w` when `reps === 1`. Round to 1 decimal.
  - `getPersonalRecords(exerciseId)` →
    `{ maxWeight: {…set}, maxReps: {…set}, best1RM: { value, set }, maxVolume }`
    computed over non-warmup sets only
  - `getExerciseHistory(exerciseId, { limit })` → per-workout summary
    `[{ workoutId, date, sets, topSetKg, best1RM, volumeKg }]`, newest first
- Endpoints:
  - `GET /api/exercises/:id/records` → 200, or `404` if the exercise is unknown
  - `GET /api/exercises/:id/history?limit=n`
  - `GET /api/records` → best lift per exercise that has any sets
- A PR only counts from **non-warmup** sets. An exercise with no sets returns
  nulls rather than an error.

**Test** — `app/tests/records.test.js`: assert `estimate1RM(100, 1) === 100` and
`estimate1RM(100, 10) === 133.3` via `t.appRequire('../records')`; log
100kg×5 then 110kg×3 and assert `maxWeight` is the 110kg set.

---

### T6: Progressive overload suggestions
**STATUS: TODO**

Tell the user what to lift next — the feature that makes this more than a diary.

**Requirements**

- `app/progression.js`:
  - `suggestNextWeight(exerciseId)` → `{ suggestedKg, reason, basedOn }`
    - no history → `null` with `reason: 'no history'`
    - last session hit **all** target reps at RPE ≤ 8 → add an increment
    - otherwise → repeat the same weight, `reason: 'repeat'`
    - increments: barbell `2.5kg`, dumbbell `2kg`, machine/cable `5kg`,
      bodyweight `0` (suggest more reps instead)
  - `getPlateBreakdown(targetKg, { barKg = 20, available })` →
    plates per side, e.g. `120kg → [25, 25, 5]`; return the closest achievable
    weight plus a `remainderKg` when it cannot be made exactly
- Endpoints:
  - `GET /api/exercises/:id/suggestion`
  - `GET /api/plates?target=100&bar=20`

**Test** — `app/tests/progression.test.js`: `getPlateBreakdown(120)` returns
per-side plates summing to 50kg; a target below bar weight returns an empty
plate list with a clear reason.

---

### T7: Routines & templates
**STATUS: TODO**

Stop rebuilding the same session by hand every week.

**Requirements**

- `app/routines.js`:
  - `seedRoutines()` — idempotent; ship at least "Push", "Pull", "Legs" and
    "StrongLifts 5×5" built from seeded exercise ids
  - `listRoutines()`, `createRoutine({ name, exercises })` (validate every
    `exerciseId` exists; reject an empty list with 400)
  - `startFromRoutine(routineId)` — starts a workout with `routineId` set and
    returns it together with the planned exercises
  - `deleteRoutine(id)` — built-in routines cannot be deleted (`403`)
- Endpoints: `GET/POST /api/routines`, `GET /api/routines/:id`,
  `DELETE /api/routines/:id`, `POST /api/routines/:id/start`
- `GET /api/workouts/:id` gains `routineProgress`:
  `[{ exerciseId, name, targetSets, completedSets }]` when the workout came
  from a routine.

**Test** — `app/tests/routines.test.js`: seeded routines are non-empty; starting
from a routine creates a workout whose `routineId` matches and whose
`routineProgress` lists the planned exercises with `completedSets: 0`.

---

### T8: Statistics & charts data
**STATUS: TODO**

The numbers behind the graphs.

**Requirements**

- `app/stats.js`:
  - `volumeByWeek({ weeks = 12 })` → `[{ weekStart, volumeKg, workouts, sets }]`,
    ISO weeks starting Monday, **including zero-volume weeks** so a chart has no
    gaps
  - `muscleGroupBalance({ days = 30 })` → volume and set count per muscle group,
    plus each group's percentage of the total
  - `workoutFrequency({ days = 90 })` → `{ total, perWeekAvg, byWeekday }`
  - `getSummary()` → `{ totalWorkouts, totalSets, totalVolumeKg, favouriteExercise,
    last7Days: { workouts, volumeKg } }`
- Endpoints: `GET /api/stats/volume`, `/api/stats/balance`,
  `/api/stats/frequency`, `/api/stats/summary`
- All of these must return valid, empty-but-well-formed data on a brand-new
  install (no crashes, no `NaN`, no `null` where a number is expected).

**Test** — `app/tests/stats.test.js`: on a fresh-ish DB call `/api/stats/summary`
and assert every numeric field is a number and not `NaN`; log one workout with
known sets and assert `totalVolumeKg` increases by exactly the expected amount.

---

### T9: Streaks & body-weight log
**STATUS: TODO**

Consistency tracking and the other number people care about.

**Requirements**

- `app/streaks.js`:
  - `getStreak()` → `{ current, longest, lastWorkoutDate }` in **days**, where a
    streak means at least one finished workout in a calendar week — define it as
    consecutive *weeks* with ≥1 workout and document the choice in the file
  - `getCalendar({ year, month })` → `[{ date, workouts, volumeKg }]` for every
    day of that month, including empty days
  - `logBodyWeight({ date, weightKg })` — one entry per date, later writes
    overwrite; validate 20–500 kg
  - `getBodyWeightHistory({ days = 90 })` → ascending by date, with a
    7-day moving average on each point
- Endpoints: `GET /api/streak`, `GET /api/calendar?year=&month=`,
  `GET/POST /api/bodyweight`
- An invalid month (`0`, `13`, `abc`) returns `400`.

**Test** — `app/tests/streaks.test.js`: log body weight twice for the same date
and assert only one entry exists with the later value; assert
`/api/calendar?year=2026&month=1` returns 31 entries.

---

### T10: Export & import
**STATUS: TODO**

It is your data — you must be able to get it out and back in.

**Requirements**

- `app/transfer.js`:
  - `exportAll()` → `{ version: 1, exportedAt, exercises, workouts, sets,
    routines, bodyweight }`
  - `importAll(payload, { mode })` where `mode` is `'merge'` or `'replace'`
    - validates `version`, rejects unknown versions with `400`
    - `merge` keeps existing ids and skips duplicates; `replace` wipes first
    - returns `{ imported: { exercises: n, workouts: n, sets: n, … }, skipped: n }`
    - **must be atomic**: if validation fails partway, nothing is written
  - `toCsv(sets)` → header `date,exercise,weightKg,reps,rpe,isWarmup`, quoting
    any field containing a comma or quote
- Endpoints:
  - `GET /api/export` → JSON download (`Content-Disposition: attachment`)
  - `GET /api/export.csv` → the CSV of all sets
  - `POST /api/import?mode=merge|replace`

**Test** — `app/tests/transfer.test.js`: export, then import the same payload in
`merge` mode and assert nothing is duplicated (counts unchanged); assert
`/api/export.csv` starts with the exact header row.

---

### T11: Web dashboard
**STATUS: TODO**

A usable front end, no build step, works on a phone.

**Requirements**

- `app/public/index.html` — one self-contained page (inline CSS + JS, no CDN, no
  framework):
  - **Log tab**: start/finish a workout, pick an exercise, big touch-friendly
    weight/reps inputs, "add set", and the suggested next weight from T6
  - a rest timer that counts up after each logged set
  - **History tab**: recent workouts, expandable to show their sets
  - **Stats tab**: volume-by-week bar chart and muscle-group balance drawn with
    inline SVG (no chart library), plus the summary numbers
  - **Body tab**: body-weight entry and its trend line
  - mobile-first layout, ≥44px tap targets, dark theme
  - friendly error messages — never a raw stack trace
- Serve `GET /` and static files from `app/public/`, guarding against path
  traversal (`../`).

**Test** — `app/tests/ui.test.js`: `GET /` returns 200 with `text/html` and a
body containing `<form` or `id="log"`; assert `GET /../server.js` does **not**
return source.

---

### T12: Metrics & observability
**STATUS: TODO**

Make it operable.

**Requirements**

- `app/metrics.js`:
  - `increment(name, by = 1)` and `snapshot()` → counters plus
    `{ uptime, memoryMb, startedAt }`
  - counters: `http_requests_total`, `errors_total`, `sets_logged_total`,
    `workouts_started_total`, `workouts_finished_total`
- `GET /metrics` → `200` plain-text Prometheus format (`# HELP`, `# TYPE`, then
  `name value`).
- `GET /api/health` extends to `{ status, uptime, version, checks: { storage: 'ok' },
  counts: { exercises, workouts, sets } }` — **keep the existing `status` and
  `uptime` fields** so T1's test still passes.
- One JSON log line per request to stdout: `method`, `path`, `status`,
  `durationMs`. Never log request bodies.

**Test** — `app/tests/metrics.test.js`: log a set, then `GET /metrics` and assert
the body contains `sets_logged_total` with a numeric value ≥ 1.

---

## Activity Log

<!-- Agents append one line here per completed task -->
