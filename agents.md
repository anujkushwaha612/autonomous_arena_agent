# AgentChain — Impostor, a browser social-deduction game

The **task brain**. Each agent completes exactly **one** task, then hands off.

> Protocol lives in `AGENT_PROMPT.md` (the worker pastes it into Arena each round).
> Summary: clone → read this file + `NEXT.md` → do the first unfinished task →
> flip it to `DONE` → upload the patch via curl → print the receipt marker.

**Never paste a diff or base64 into chat.** The patch is uploaded out-of-band.

---

## Repository layout — READ THIS BEFORE TOUCHING ANYTHING

This repository is **not** the product. It is an autonomous build pipeline that
*contains* the product:

```
<repo root>
├── worker.js, config.js, fastcapture/, scripts/   ← PIPELINE. Never edit.
├── package.json         ← PIPELINE's package.json. NOT the game's.
├── agents.md            ← this file (you flip your task's STATUS)
├── NEXT.md              ← handoff notes (you rewrite this)
└── app/                 ← THE GAME. Everything you build goes here.
```

**All game code lives under `app/`.** The only files you may modify outside
`app/` are `agents.md` and `NEXT.md`. Never create or overwrite `package.json`
at the repository root — it belongs to the worker, and replacing it breaks the
pipeline that is running you.

### If you are the first agent

`app/` will not exist yet. That is expected:

```bash
mkdir -p app
```

Build your task inside it. Do not scaffold later tasks, do not create empty
placeholder folders, do not "tidy" the pipeline files.

### The task list is complete as written

Every task that will ever exist is listed below. A missing higher number means
the plan ends there — it is not an invitation to invent, renumber, split or
merge tasks. Unfamiliar files in the repo root are pipeline machinery.

The list was extended **once**, before any task was started, to close feature
gaps (T17–T20 added; deployment moved to T21 — see *Plan revisions* at the
bottom). It is complete again. Do not extend it further. Anything deliberately
left out is in **Out of scope**, also at the bottom — building something from
that list is a failed round, not initiative.

**Do exactly one task. Change nothing else.**

---

## The game

**Impostor** — a real-time social-deduction game for 4–12 players in the
browser. Crewmates complete tasks around a map; impostors sabotage and
eliminate them. Emergency meetings trigger discussion and voting.

Playable by sharing a 4-letter room code. No install, no account, no download.

### Win conditions

- **Crewmates win** by completing all tasks, or voting out every impostor.
- **Impostors win** when impostors ≥ living crewmates, or a critical sabotage
  timer expires.

---

## Stack — chosen so it cannot break

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript**, `strict: true` | one language both sides |
| Server | **Node 20 + `ws`** | the only runtime dependency that matters |
| Client | **Canvas 2D + vanilla TS** | no engine to fight; 60fps is easy at this scale |
| Bundler | **esbuild** | one binary, sub-second builds, no config sprawl |
| Transport | **WebSocket, binary-free JSON** | debuggable; bandwidth is not our bottleneck |
| State | **In-memory `Map`** | rooms are ephemeral; a DB adds nothing |
| Tests | pipeline smoke tests + scratch verification | see Verification |

**Dependencies are capped at four**: `ws`, `esbuild`, `typescript`, `tsx`.
Adding a fifth requires a very good reason written into `NEXT.md`. No React, no
Phaser, no Colyseus, no Socket.IO — every dependency is an install that can fail
on another machine and break every later task.

### Why not Fable/F#

Your friends are using Fable. We are deliberately taking the boring path: the
pipeline's agents write far more reliable TypeScript than F#, the toolchain is
`npm install` rather than a .NET SDK, and iteration is seconds not minutes. We
win on **shipped features**, not on language novelty.

### Project shape

```
app/
├── package.json          # ONE package.json. type: "module"
├── tsconfig.json
├── esbuild.config.js
├── public/
│   ├── index.html
│   └── style.css
└── src/
    ├── server/
    │   ├── index.ts      # http + ws entry point
    │   ├── rooms.ts      # room registry & lifecycle
    │   ├── protocol.ts   # message validation
    │   ├── game.ts       # authoritative game loop
    │   ├── movement.ts   # position updates & collision
    │   ├── tasks.ts      # task assignment & progress
    │   ├── sabotage.ts   # sabotage system
    │   ├── meeting.ts    # meetings, voting, ejection
    │   ├── vision.ts     # per-player visibility filtering
    │   ├── surveillance.ts # admin / cameras / vitals / door log (T10)
    │   ├── roles.ts      # role registry & extended roles (T11)
    │   ├── browser.ts    # public lobby list & quick join (T18)
    │   └── moderation.ts # kick/ban, AFK, text safety (T19)
    ├── client/
    │   ├── main.ts       # bootstrap & scene switching
    │   ├── net.ts        # socket, reconnect, interpolation, clock offset
    │   ├── render.ts     # canvas draw loop
    │   ├── input.ts      # keyboard/touch
    │   ├── ui/           # lobby, hud, map overlay, meeting, minigames
    │   └── assets.ts     # procedural sprites (no binary assets)
    └── shared/
        ├── types.ts      # message & entity types used BY BOTH sides
        ├── constants.ts  # speeds, radii, timers — one source of truth
        └── map.ts        # map geometry (T3) → becomes shared/maps/ in T20
```

### The two commands that must always work

```bash
npm run dev     # esbuild watch + server with reload
npm start       # build client, then serve client + ws on ONE port
```

`npm start` **must** serve the built client and the WebSocket on
`process.env.PORT || 3000`. The pipeline boots exactly this and waits on that
one port. Two ports, or a separate build step, breaks every later task.

---

## Non-negotiable engineering rules

1. **The server is authoritative.** The client sends *intent* (`move`, `use`,
   `kill`, `vote`) and renders what the server confirms. Never trust a
   client-sent position, role, or kill.
2. **Never leak secret state.** A crewmate's socket must never receive the
   impostor list, another player's role, or entities outside their vision.
   Filtering happens server-side in `vision.ts`, not in the client renderer.
   This is the single easiest way to ruin the game — treat it as a security
   boundary.
3. **All tuning constants live in `shared/constants.ts`.** No magic numbers in
   game logic. Speeds, cooldowns, radii, timer lengths — one place.
4. **Every message is validated** against `shared/types.ts` before it reaches
   game logic. An unknown or malformed message is dropped with a logged warning,
   never a crash.
5. **The game loop is fixed-step** (20 ticks/sec) and independent of frame rate.
   Rendering interpolates between the last two server snapshots.
6. **Once a message type or field name ships in a completed task it is frozen.**
   Add fields; never rename or remove.
7. **Every function you call must exist.** If you call `rooms.getPlayer()`,
   define and export it in the same patch. A missing export compiles fine and
   crashes at runtime; the worker's contract check will reject your round.
8. **No business logic in the renderer.** `render.ts` draws state; it never
   decides outcomes.
9. **A room must clean itself up.** When the last socket disconnects, the room
   and its timers are destroyed. No leaks, no zombie intervals.
10. **Accessibility & feel:** keyboard *and* touch controls, colour-blind-safe
    player colours with distinct patterns, and no flashing faster than 3Hz.

---

## Shared protocol

Client → server:

```ts
type ClientMsg =
  | { t:'join';    code:string; name:string }
  | { t:'create';  name:string }
  | { t:'move';    dx:number; dy:number }        // unit vector, server clamps
  | { t:'use' }                                   // context action
  | { t:'kill';    targetId:string }
  | { t:'report';  bodyId:string }
  | { t:'meeting' }
  | { t:'vote';    targetId:string | null }       // null = skip
  | { t:'chat';    text:string }
  | { t:'vent';    to:number }
  | { t:'sabotage';kind:SabotageKind }
  | { t:'taskStep';taskId:string; step:number }
  | { t:'ready';   value:boolean }
  | { t:'settings';patch:Partial<Settings> }
  | { t:'console'; kind:ConsoleKind; open:boolean }   // admin|cameras|vitals|doorlog
  | { t:'ability'; kind:AbilityKind; targetId?:string } // shield|shift|revert|scan
  | { t:'quickchat'; phraseId:number }
  | { t:'cosmetic'; colour?:number; hat?:number; skin?:number; visor?:number; pet?:number }
  | { t:'quickjoin'; name:string }                     // T18 — join or create a public lobby
  | { t:'mod';     action:'kick'|'ban'|'votekick'; targetId:string } // T19 — host only
  | { t:'pong';    at:number }                         // T15 heartbeat / T17 clock offset
```

Server → client:

```ts
type ServerMsg =
  | { t:'joined';   you:string; room:RoomView }
  | { t:'snapshot'; tick:number; players:PlayerView[]; you:SelfView }
  | { t:'phase';    phase:'lobby'|'playing'|'meeting'|'ended'; endsAt?:number }
  | { t:'meeting';  reason:'report'|'emergency'; bodyId?:string; by:string }
  | { t:'votes';    tally:Record<string,number>; revealed:boolean }
  | { t:'ejected';  playerId:string|null; wasImpostor:boolean|null }
  | { t:'tasks';    list:TaskView[]; progress:number }
  | { t:'sabotage'; kind:SabotageKind|null; endsAt?:number }
  | { t:'chat';     from:string; text:string; at:number }
  | { t:'ended';    winner:'crew'|'impostor'; reason:string; reveal:Role[] }
  | { t:'error';    code:string; message:string }
  | { t:'console';  kind:ConsoleKind; data:unknown }   // server-filtered payload
  | { t:'visual';   kind:string; playerId:string; at:number } // witnessable animation
  | { t:'ability';  kind:AbilityKind; by:string; ok:boolean }
  | { t:'ping';     at:number }                        // server clock, for countdown sync
  | { t:'kicked';   reason:string }                    // T19
```

Every `endsAt` in a `ServerMsg` is a **server** timestamp. Clients render
countdowns against the offset measured from `ping`/`pong`, never against a raw
local `Date.now()` (T17).

`PlayerView` contains only what that recipient may see. `SelfView` carries your
own role, tasks and cooldowns.

---

## Verification — prove it works, don't ship test files

**You must run your code before handing off.** Start the server, open two
connections, drive the behaviour your task adds. Write whatever scratch scripts
help — then **delete them**.

```bash
cd app
npm run typecheck        # MANDATORY — see below
npm run build
cd .. && node fastcapture/smoke.js
```

**`npm run typecheck` is your most important check.** The pipeline's static
contract check understands CommonJS `require()`, not TypeScript `import` — so
for this project it will *not* catch you importing a function that does not
exist. `tsc --noEmit` will, instantly. A round that skips it can ship code that
compiles in your head and crashes on the first connection.

### When to commit a test — the exception, not the rule

Commit a test only where a later task can silently break a contract. Those
tasks say **COMMIT this test** explicitly. Everywhere else: verify, then delete.

Committed test files:

- live in `app/tests/`, named `*.test.js`
- use **`export default async (t) => {…}`** (the game is `type: "module"`;
  `module.exports` will fail to load)
- talk to the running server over HTTP/WebSocket — never import `src/`
- helpers: `t.get/post`, `t.assert(.equal/.truthy)`, `t.sleep`, `t.baseUrl`,
  `t.wsUrl`, `t.appRequire('ws')`

---

## Task list

### T1: Server skeleton, static hosting & build
**STATUS: DONE**

Nothing else can start without this.

**Requirements**

- `app/package.json` — `type: "module"`, deps exactly `ws`, `esbuild`,
  `typescript`, `tsx`. Scripts: `dev`, `build`, `start`, `typecheck`.
- `app/tsconfig.json` with `strict: true`.
- `app/esbuild.config.js` bundling `src/client/main.ts` →
  `app/public/bundle.js` (ESM, sourcemaps in dev, minified in build).
- `app/src/server/index.ts`: `http` server that serves `app/public/` (guarding
  against `../` traversal), attaches a `ws` server on the same port, and
  listens on `PORT || 3000`.
- `GET /api/health` → `200 {"status":"ok","rooms":0,"uptime":n}`.
- `app/public/index.html` + `style.css` — dark theme, a canvas element, and a
  centred lobby panel.
- `app/src/client/main.ts` — connects the socket, logs `open`.
- `app/.gitignore`: `node_modules/`, `public/bundle.js*`, `.env`.

**COMMIT this test** — `app/tests/health.test.js`: health returns 200 with
`status === 'ok'`; `GET /` returns HTML; `GET /../package.json` does not return
source.

---

### T2: Rooms, join/create & lobby state
**STATUS: TODO**

**Requirements**

- `shared/types.ts` and `shared/constants.ts` seeded with the protocol above
  and initial tuning values.
- `server/rooms.ts`: `createRoom(hostName)` → unambiguous 4-letter code
  (no `I`,`O`,`0`,`1`), `joinRoom(code,name)`, `leaveRoom`, `getRoom`,
  `listPlayers`, `destroyRoom`. Max 12 players; duplicate names get a numeric
  suffix.
- `server/protocol.ts`: `parse(raw)` → a validated `ClientMsg` or `null`.
  Reject unknown `t`, wrong field types, oversized payloads (>4 KB), and
  names outside 1–16 printable characters.
- On any membership change, broadcast `joined`/`snapshot` to the room.
- Host is the first player; if the host leaves, the longest-present player is
  promoted.
- Rooms self-destroy when empty.

**COMMIT this test** — `app/tests/lobby.test.js`: two WebSocket clients join
the same code and both observe a player count of 2; joining a nonexistent code
returns an `error` message with a code, not a disconnect.

---

### T3: Map geometry & collision
**STATUS: TODO**

**Requirements**

- `shared/map.ts`: a hand-authored map as data — walls as line segments, ~8
  named rooms (Cafeteria, Reactor, Electrical, MedBay, Navigation, Storage,
  Shields, Admin), corridors connecting them, 4 vent nodes with links, and
  named task locations.
- `server/movement.ts`: `step(player, dx, dy, dt)` with circle-vs-segment
  collision and wall sliding. Speed comes from `constants.ts`.
- `roomAt(x,y)` → the named room containing a point.
- Client renders walls and rooms from the same `shared/map.ts` — the map is
  defined **once**.

**Verify (do not commit a test file)** — prove a player cannot cross a wall,
slides along it rather than sticking, and that `roomAt` returns the right name
at several points.

---

### T4: Real-time movement & interpolation
**STATUS: TODO**

**Requirements**

- Fixed 20Hz server tick broadcasting `snapshot` with each player's position.
- Client sends `move` intent at most 20/sec; the server clamps to a unit vector
  and applies its own speed — a client cannot move faster by spamming.
- `client/net.ts` buffers the last two snapshots and interpolates render
  positions; `client/render.ts` draws at `requestAnimationFrame`.
- Smooth camera follow with the map clamped to viewport edges.
- Keyboard (WASD/arrows) and an on-screen touch joystick.

**Verify (do not commit a test file)** — with two browser tabs (or two socket
clients), confirm both see each other move within ~100ms and that a client
sending `move` at 200Hz does not travel faster.

---

### T5: Roles, game start & the kill loop
**STATUS: TODO**

**Requirements**

- Host starts the game with ≥4 players. Impostor count from settings
  (1 for 4–6, 2 for 7–9, 3 for 10–12), assigned by cryptographic shuffle.
- `SelfView.role` is sent **only** to that player. Verify by inspecting the raw
  frames a crewmate receives — the impostor list must not appear anywhere.
- Impostor `kill` requires: target alive, within `KILL_RADIUS`, cooldown
  elapsed, not in a meeting. Produces a body at the victim's position.
- Killed players become ghosts: they see everything, can move through walls,
  and can still complete tasks but cannot vote or chat with the living.
- `report` on a nearby body triggers a meeting.
- Per-map spawn points and a start countdown. A **role reveal splash** ("You
  are a Crewmate / Impostor", fellow impostors named) plays before movement
  unlocks, driven entirely by `SelfView` — the reveal must not be assembled
  from data other players also received.
- The kill cooldown starts after the reveal, and resets after every meeting.
- **Venting (impostor only):** `vent` enters the nearest vent node when within
  `VENT_RADIUS`, moves between *linked* nodes only, and exits only at a node.
  While vented the player is invisible to everyone (absent from their
  snapshots, not merely undrawn), cannot kill, and cannot be killed. Entering
  and exiting play an animation and are visible to anyone who can see that
  vent — being spotted venting is the core tell of the game.

**COMMIT this test** — `app/tests/roles.test.js`: start a 4-player game and
assert that a crewmate's received messages never contain another player's
`role` field, and that a kill outside `KILL_RADIUS` is rejected.

---

### T6: Vision, line-of-sight & ghosts
**STATUS: TODO**

**Requirements**

- `server/vision.ts`: `visibleTo(player, room)` → the filtered `PlayerView[]`
  using a radius from `constants.ts` (impostors see further) plus wall
  occlusion — you cannot see through a wall.
- Snapshots are built **per recipient**. A player outside your vision is simply
  absent from your snapshot, not merely undrawn.
- Client renders a soft vision cone/circle mask over the map.
- Ghosts see the full map and other ghosts; the living never see ghosts.

**COMMIT this test** — `app/tests/vision.test.js`: two players in different
rooms do not appear in each other's snapshots; when they move adjacent, they do.

---

### T7: Tasks & progress bar
**STATUS: TODO**

**Requirements**

- `server/tasks.ts`: assign each crewmate N tasks (from settings) across
  distinct map locations. Task kinds: `short`, `long` (two steps), `common`
  (identical for everyone).
- `taskStep` validates proximity to the task location and correct step order.
- A player's tasks are drawn from distinct locations where the map allows it;
  the number of `common` tasks is its own setting, separate from short/long.
- Global progress = completed steps ÷ total steps across **crewmates only**;
  broadcast on every change. Impostors see a progress bar that never advances
  from their own actions.
- Crew win when progress reaches 100%.

**Verify (do not commit a test file)** — complete a task from the wrong
location and confirm rejection; complete all tasks with one crewmate and
confirm the progress maths is right.

---

### T8: Task minigames
**STATUS: TODO**

**Requirements**

- `client/ui/minigames/` with at least six, all canvas/DOM, no assets:
  wiring (drag to connect colours), keypad code entry, asteroid clicking,
  card swipe (speed-sensitive), fuel-hold, and a simple alignment puzzle.
- Each reports completion via `taskStep`; the server is the source of truth —
  a client cannot mark a task complete without the interaction.
- Fully keyboard-operable, and touch-friendly.
- **Visual tasks** (toggleable in settings) — tasks that play a world-space
  animation *other players can witness*, proving innocence:
  `Empty Garbage` (a chute animation in Storage), `Prime Shields` (the ship's
  shield hexagons light up, visible from anywhere), `Clear Asteroids`
  (turret fires), `Submit Scan` in MedBay (a full-body scan bar that takes
  several seconds and locks you in place). The animation is broadcast to
  everyone with line of sight, **not** just the player doing it. An impostor
  attempting a visual task must produce **no** animation — that is the point.

**Verify (do not commit a test file)** — play each minigame to completion and
confirm the task progresses; confirm closing a minigame early does not; confirm
an impostor faking a visual task produces no broadcast animation.

---

### T9: Sabotage system
**STATUS: TODO**

**Requirements**

- `server/sabotage.ts`. Kinds: `lights` (reduces crew vision), `comms`
  (hides the task list), `oxygen` and `reactor` (**critical** — a countdown
  that ends the game for crew if it expires), `doors` (temporarily seals a
  room).
- Only impostors may sabotage; a global cooldown applies; only one active
  sabotage at a time.
- Fixing requires crewmates at the correct location — criticals need **two
  players at two different panels simultaneously**.
- `doors` cannot be fixed by crew — it expires on its own timer.
- The impostor's sabotage menu offers only the kinds the current map declares
  (see T20); a sabotage kind the map does not have is rejected.
- HUD shows the active sabotage and countdown; the map highlights fix points.

**COMMIT this test** — `app/tests/sabotage.test.js`: a crewmate attempting
sabotage is rejected; a critical sabotage sets a countdown; a second sabotage
during an active one is rejected.

---

### T10: Surveillance — Admin, Cameras, Vitals & Door Log
**STATUS: TODO**

The information systems that make deduction possible. Without these the game is
guesswork; with them, players build real cases.

**Requirements**

- `server/surveillance.ts`, all **server-filtered** — a client must never
  receive data it has not physically walked to a console to obtain.
- **Admin table** (Admin room): a live map showing a *count* of players per
  room, never names. Uses the same `roomAt()` from T3.
- **Security cameras** (Security room): view 4 fixed camera positions showing
  players within each camera's radius. While *anyone* is watching cameras, a
  red blinking light appears on those cameras for players in the room — a
  classic tell.
- **Vitals** (MedBay): a panel listing every player as `alive` or `dead`.
  Dead shows only once the kill has happened, giving crewmates a timing signal.
- **Door Log** (Communications): a timestamped list of the last N room
  entries/exits, `{ time, playerColour, room, direction }` — colour, not name.
- Each console requires proximity to use and closes when you walk away.
- **`comms` sabotage disables Admin, Cameras and Door Log** (not Vitals);
  `lights` sabotage reduces what cameras show.

**COMMIT this test** — `app/tests/surveillance.test.js`: a player far from
Admin who requests admin data is rejected; a player at Admin receives room
*counts* with no player names or ids; after a kill, Vitals reports exactly one
dead.

---

### T11: Extended roles — Engineer, Scientist, Guardian Angel, Shapeshifter
**STATUS: TODO**

Optional roles, each toggleable in settings with a probability and count. All
role state is secret and server-side.

**Requirements**

- `server/roles.ts` — a role registry so later tasks add roles without editing
  the game loop.
- **Engineer** (crew): may use vents, with a per-game or cooldown-limited
  duration. Full vent access from T5, but crew-aligned.
- **Scientist** (crew): may check Vitals from anywhere via a personal battery
  that depletes while open and recharges over time.
- **Guardian Angel** (ghost): may shield one living player for a short duration
  on a cooldown; a shielded player survives one kill attempt. The impostor sees
  the attempt fail; the shield flashes.
- **Shapeshifter** (impostor): may take another player's exact appearance
  (colour, hat, name) for a duration on a cooldown. Shifting and reverting are
  visible **only** to anyone with line of sight at that moment.
- Role assignment respects counts and never assigns two roles to one player.
- The end-of-game reveal shows every player's role, not just impostor/crew.

**COMMIT this test** — `app/tests/extendedroles.test.js`: with Guardian Angel
enabled, a shielded player survives a kill and the impostor's cooldown still
resets; a Shapeshifter's `shift` message from a non-shapeshifter is rejected.

---

### T12: Meetings, discussion & voting
**STATUS: TODO**

**Requirements**

- `server/meeting.ts`: triggered by `report` or `meeting` (emergency, limited
  per player per game, with a cooldown after game start).
- An emergency meeting requires standing at the **emergency button** (a
  per-map position, T20) and is refused while a critical sabotage is active or
  while the caller is dead, vented or in a minigame.
- Phases with timers from settings: discussion → voting → reveal. All players
  teleport to the meeting table; movement is frozen.
- Text chat during discussion, living players only; ghosts get a separate
  ghost channel.
- One vote per living player, changeable until the timer ends; skip allowed.
  Tally is hidden until reveal (configurable), ties result in no ejection.
- **Anonymous votes** (setting): the tally shows counts without revealing who
  voted for whom.
- **Quick Chat**: a fixed phrase list ("Where?", "I saw <colour> vent",
  "<colour> is sus", "Skip", "I did <task> in <room>") composed from menus, so
  the game is playable without free typing. Free chat remains, toggleable.
- Dead players' chat is visible only to other dead players — verify this by
  inspecting a living player's raw frames.
- Ejection reveals whether they were an impostor (configurable) and checks the
  win conditions.

**COMMIT this test** — `app/tests/meeting.test.js`: three clients meet, two
vote for the same player, that player is ejected and the remaining players
receive an `ejected` message with the correct id.

---

### T13: Win conditions, round flow & spectating
**STATUS: TODO**

**Requirements**

- Continuous evaluation after every kill, ejection, task completion and
  sabotage expiry: crew win by tasks or by ejecting all impostors; impostors
  win on parity or critical-sabotage expiry.
- `ended` reveals all roles and the reason; a results screen shows who was who.
- Host can start a new round with the same players; roles reshuffle and state
  fully resets — **no leakage from the previous round**.
- Ghosts spectate freely and correctly become living players next round.

**COMMIT this test** — `app/tests/winconditions.test.js`: with 1 impostor and 1
crewmate remaining, a kill produces `ended` with `winner: 'impostor'`; a fresh
round resets `phase` to `lobby`.

---

### T14: Lobby, settings & customisation
**STATUS: TODO**

**Requirements**

- Lobby UI: room code with a copy button, player list with ready states,
  host-only start.
- Host-editable settings, validated server-side and broadcast to everyone:
  impostor count, crew/impostor speed, vision radii, kill cooldown and radius,
  emergency meeting count, discussion and voting seconds, tasks per player
  (short/long/common), confirm-ejects, visual-tasks on/off, anonymous votes,
  map id (T20), max players, **public/private lobby** (T18, default private),
  AFK timeout and reconnect grace period (T19/T15).
- Player customisation, all **procedurally drawn** (no binary assets):
  12 colour-blind-safe colours each with a distinct pattern, ~10 hats,
  ~6 skins (body overlays), ~4 visors, and ~4 pets that follow the player with
  eased trailing movement. Cosmetics are cosmetic only — never a gameplay edge.
  Colours are unique per room; taken colours show as unavailable.
- **Task bar mode** (setting): `always` / `meetings only` / `never` —
  a major difficulty lever, since a hidden bar removes the crew's clock.
- Settings persist in `localStorage` between sessions.

**Verify (do not commit a test file)** — change every setting and confirm it
takes effect in the next round; confirm a non-host cannot change settings even
by sending the message directly.

---

### T15: Reconnection, resilience & anti-cheat
**STATUS: TODO**

**Requirements**

- A disconnected player has a grace period (from settings) to rejoin with the
  same identity and resume their role, tasks and position.
- Heartbeat ping/pong; drop sockets that stop responding.
- Rate-limit every message type per socket; kick on sustained abuse.
- Reject impossible input server-side: out-of-range movement deltas, kills
  through walls, votes from the dead, task steps from across the map. Log each
  rejection with the player id.
- **Phase gating is part of validation**: movement during a meeting, votes
  outside the voting window, sabotage in the lobby and task steps after the
  game ends are all rejected, not merely ignored by the client.
- The room survives the host leaving mid-game.

**COMMIT this test** — `app/tests/resilience.test.js`: a socket that
disconnects and rejoins within the grace period keeps its player id; a flood of
1000 messages results in rate limiting rather than a crash.

---

### T16: Audio, polish & feel
**STATUS: TODO**

**Requirements**

- **Procedurally generated audio** via WebAudio — no binary assets: footsteps,
  kill sting, meeting alarm, sabotage klaxon, task-complete chime, vote blip.
  A global mute persisted to `localStorage`.
- **2.5D depth rendering** — the look Among Us actually has, achieved in 2D:
  - **Y-sorted draw order**: entities lower on the screen draw in front, so
    players correctly occlude one another and props.
  - **Soft drop shadows** under every player, scaled by sprite size.
  - **Parallax**: a background starfield layer scrolls slower than the map.
  - **Wall height illusion**: draw a short vertical face plus a top edge for
    each wall segment rather than a flat line.
  - **Layered lighting**: a dark overlay with a radial cut-out for vision,
    plus warm pools of light under ceiling lamps, multiplied — this single
    effect does most of the work of making a flat map feel spatial.
  - **Squash-and-stretch** on the walk cycle, and a slight lean into movement.
- Visual polish: walk animation, kill animation, body sprite, vent
  open/close, meeting transition wipe, damage vignette during criticals.
- **Responsive layout**: the canvas and every overlay scale from a 360px-wide
  phone in portrait to a desktop window, honouring safe-area insets. Touch
  controls reposition for portrait; nothing important sits under a thumb.
- Nothing flashes faster than 3Hz; a `prefers-reduced-motion` mode disables
  screen shake and wipes.
- Performance: 60fps with 12 players on a mid-range laptop. Draw only what is
  visible; no per-frame allocation in the render loop.

**Verify (do not commit a test file)** — run with 12 simulated players and
confirm the frame budget holds; confirm mute persists across a reload.

---

### T17: HUD, interaction layer & ghost UX
**STATUS: TODO**

The plan builds a correct simulation but never specifies the screen the player
actually looks at. This task is that screen. It is where the game becomes
playable rather than merely running.

**Requirements**

- `client/ui/hud.ts` — the persistent in-game layer, drawn from server state
  only (rule 8 still applies: it renders, it never decides):
  - **Task list panel** with per-task room + name, struck through on
    completion, hidden or shown per the task-bar setting from T14.
  - **Global progress bar**, animated between values, never jumping.
  - **Context action button** (`use`) that names the thing you are standing on
    — `Use Admin`, `Fix Wiring`, `Report Body`, `Emergency Meeting` — greyed
    out when out of range, with the same keybind on desktop (`E`) and a large
    thumb target on touch.
  - **Kill button with a radial cooldown dial** for impostors, plus a separate
    `Sabotage` and `Vent` button; all three disabled with a visible reason
    rather than silently doing nothing.
  - **Sabotage banner + countdown**, and directional arrows pointing to the
    fix points of the active sabotage.
- `client/ui/mapoverlay.ts` — a full-screen map, opened with `Tab`/a button,
  showing rooms, your task markers and (for impostors) the sabotage menu
  wired to the same targets. Opening it does **not** pause the game.
- **Countdown clock sync**: `net.ts` measures the offset between server and
  client clocks from `ping`/`pong` and every timer in the UI renders against
  that offset. A client with a skewed clock must still see the correct number.
- **Ghost UX**: a desaturated palette, ghost-only chat channel indicator, the
  remaining-tasks panel still usable, and a clear "you are dead" state that
  cannot be confused with being alive.
- **Death / ejection sequences**: the victim sees a kill cam, everyone sees
  the ejection animation with the configured confirm-ejects text.
- Every button is reachable by keyboard with a visible focus ring, and every
  interactive element has an accessible name.

**Verify (do not commit a test file)** — walk to a console and confirm the
context button names it and greys out when you step away; skew the client
clock by 30 seconds and confirm a sabotage countdown still reads correctly;
confirm an impostor's kill button shows a reason when disabled.

---

### T18: Public lobby browser & quick join
**STATUS: TODO**

A 4-letter code only works if you already have friends online. Without this the
game is empty for a solo visitor, which is the most common first experience.

**Requirements**

- `server/browser.ts`: a registry of rooms whose host set them **public** in
  settings. Private is the default and a private room is never listed.
- `GET /api/lobbies` → an array of `{ code, hostName, players, max, mapId,
  impostors, phase }` for public rooms in `lobby` phase only. No player ids,
  no names beyond the host's, never a room mid-game.
- `quickjoin` picks the fullest joinable public lobby, and creates a new public
  room if there is none — one click from the front page to a game.
- The lobby browser UI lists rooms with a refresh, and shows a friendly empty
  state with a `Create room` call to action.
- A room disappears from the list the moment it starts, fills, or empties.

**COMMIT this test** — `app/tests/browser.test.js`: a private room does not
appear in `/api/lobbies`; a public room does and shows the correct player
count; `quickjoin` with no public rooms available creates one and returns a
`joined` message.

---

### T19: Moderation, AFK & text safety
**STATUS: TODO**

Any game with strangers and a chat box needs this, and retrofitting it after
the protocol freezes is far more expensive than building it now.

**Requirements**

- `server/moderation.ts`. Host may `kick` (removable, may rejoin) and `ban`
  (code-scoped, cannot rejoin for the life of the room) any other player.
  A kicked socket receives `kicked` with a reason before it is closed.
- **Vote-kick** during the lobby only, as a fallback when the host is the
  problem: a majority of the lobby removes a player.
- **AFK handling**: a player with no input for the settings timeout is marked
  AFK; if the game is running they are auto-skipped in votes, and after a
  second timeout removed so they cannot stall a round forever.
- Chat safety on the free-text channel: length cap, rate limit, control- and
  zero-width-character stripping, and a naive profanity filter with a
  host-toggleable setting. Player **names** go through the same filter at join.
- Leaving mid-game must not corrupt state: the leaver's tasks come out of the
  denominator, and the win conditions are re-evaluated immediately.

**COMMIT this test** — `app/tests/moderation.test.js`: a non-host `mod` message
is rejected; a banned player rejoining the same code receives an `error`; a
player leaving mid-game causes task progress to be recomputed against the
remaining crewmates.

---

### T20: Second map & map registry
**STATUS: TODO**

One map is a demo; the replayability of this genre comes from knowing several
maps well. This task makes the map data plural without touching game logic.

**Requirements**

- Refactor `shared/map.ts` into `shared/maps/` with a `MapDef` type and a
  registry keyed by `mapId`. **No renames of existing exported fields** —
  rule 6 holds; `shared/map.ts` may re-export the default map for compatibility.
- A `MapDef` owns: walls, named rooms, vents and links, task locations and
  which task kinds each supports, spawn points, the emergency-button position,
  sabotage fix points, camera positions, and the sabotage kinds it offers.
- Ship a **second, structurally different map** — smaller, more corridors,
  more vents — so the difference is felt, not cosmetic.
- Map is chosen in lobby settings and broadcast in `RoomView`; the client
  renders whichever map the server names, with **zero** hard-coded geometry.
- Every system that had the map baked in — movement, `roomAt`, vision,
  tasks, sabotage, surveillance, minimap — reads it from the registry.

**Verify (do not commit a test file)** — play a full round on each map;
confirm switching maps between rounds fully re-seeds task locations, spawns
and camera positions with no geometry left over from the previous map.

---

### T21: Deployment, docs & final acceptance
**STATUS: TODO**

Final task.

**Requirements**

- `npm start` serves a production build on one port with correct caching
  headers; `PORT` and `HOST` are configurable.
- `app/README.md`: how to run locally, how to play, every setting explained,
  the full protocol table, and the architecture in a paragraph.
- `GET /api/health` extends to `{status, uptime, rooms, players, version}` —
  **keep `status` and `rooms`** so T1's test still passes.
- A `?bots=N` dev flag spawns simple bot players for solo testing. Bots walk,
  complete tasks and vote randomly — enough to exercise a full round alone.
- **Browser support check**: latest Chrome, Firefox and Safari, desktop and
  mobile, including iOS Safari (test touch controls and WebAudio unlocking on
  first gesture there specifically).
- Final pass: no console errors, no memory growth over a 10-minute game, no
  unhandled promise rejections, and every earlier committed test still passing
  (`health`, `lobby`, `roles`, `vision`, `sabotage`, `surveillance`,
  `extendedroles`, `meeting`, `winconditions`, `resilience`, `browser`,
  `moderation`, `acceptance`).

**COMMIT this test** — `app/tests/acceptance.test.js`: health reports the
extended shape while still having `status === 'ok'`; a full lobby → start →
kill → meeting → eject → end sequence completes over WebSocket without error.

---

## Out of scope — deliberately not built

Listed so no agent "helpfully" adds them. Building any of these is a failed
round.

- **Accounts, persistence, databases, stats or leaderboards.** Rooms are
  ephemeral and in-memory; that is a design decision, not an omission.
- **Voice chat / WebRTC.** Players use Discord. This adds a signalling server,
  TURN, permissions and a fifth dependency for no deduction value.
- **Matchmaking beyond T18's lobby browser** — no skill rating, no queues.
- **Monetisation, cosmetics unlocks, currency.** All cosmetics are free and
  available from the start.
- **Native or mobile app wrappers.** Browser only.
- **A map editor.** T20 makes maps data; authoring them is a code change.
- **Anti-cheat beyond server authority + T15 validation.** No obfuscation, no
  client attestation.
- **i18n.** English only; keep strings in one module so it stays possible.

---

## Plan revisions

One revision, made before T1 started, after an audit for missing features:

- **Added T17 (HUD, interaction layer & ghost UX)** — the plan simulated the
  game correctly but never specified the task list panel, context-action
  button, cooldown dials, map overlay, countdown clock sync or the ghost and
  death states. Nothing was going to build the screen the player looks at.
- **Added T18 (public lobby browser & quick join)** — a 4-letter code assumes
  you already have friends waiting; a solo visitor had no path into a game.
- **Added T19 (moderation, AFK & text safety)** — kick/ban, AFK skipping and
  chat/name sanitising. Also fixes an unhandled case: a player leaving
  mid-game and its effect on task progress and win conditions.
- **Added T20 (second map & map registry)** — one hard-coded map is a demo;
  the registry keeps map data out of game logic while the protocol is still
  soft.
- **Renumbered deployment/acceptance T17 → T21** and extended it with a bot
  flag, a browser/mobile support matrix and the full committed-test list.
- Smaller gaps folded into existing tasks: role-reveal splash and spawn points
  (T5), common-task count (T7), `doors` expiry and per-map sabotage kinds (T9),
  emergency-button proximity (T12), the new settings (T14), phase gating as
  validation (T15), responsive/portrait layout (T16), and a server-clock
  `ping`/`pong` pair in the protocol.

---

## Activity Log

<!-- Agents append one line here per completed task -->
- 2026-07-25 T1 completed: server skeleton, build, health endpoint, basic static hosting.
