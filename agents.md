# AgentChain — Impostor, a browser social-deduction game

The **task brain**. Each agent completes exactly **one** task, then hands off.

> Protocol lives in `AGENT_PROMPT.md` (the worker pastes it into Arena each round).
> Summary: clone → read this file + `NEXT.md` → do the first unfinished task →
> flip it to `DONE` → upload the patch via curl → print the receipt marker.

**Never paste a diff or base64 into chat.** The patch is uploaded out-of-band.

---

## ⚠️⚠️⚠️ GLOBAL QUALITY MANDATE - READ THIS FIRST - NON-NEGOTIABLE ⚠️⚠️⚠️

### YOU ARE NOT BUILDING A PROTOTYPE. YOU ARE CLONING THE REAL AMONG US.

Every previous agent has shipped **embarrassingly basic code** that would never pass as Among Us. This stops now.

**IF YOU ARE ABOUT TO SHIP BASIC CODE, STOP AND REWRITE IT.**

Real Among Us is a polished, AAA-feel party game played by 500M+ players. Your clone must FEEL like it. If a player shows your screen recording next to real Among Us, they should not instantly tell it's fake from visuals, animation, or interaction.

#### BANNED - BASIC CODE THAT WILL FAIL YOUR ROUND:

❌ Player drawn as `fillRect(color)` circle or square
❌ Map as 8 rectangles with text labels
❌ Movement that just does `x += dx` with no collision sliding, no animation, no footstep cycle
❌ Kill that just sets `alive=false` with no animation, no body sprite, no blood, no cooldown UI
❌ Tasks as "Press E to complete" or a single button that instantly completes
❌ Minigames as `alert('done')` or one `input` field
❌ Meeting screen as `<ul><li>player names</li></ul>` and a vote button
❌ Chat as a bare `<input>` with no bubbles, no colors, no filtering
❌ Lobby as white page with 4-letter code text
❌ No shadows, no depth, no lighting, no juice, no polish
❌ Single 300-line file doing everything
❌ `// TODO: add animation later` or placeholder comments
❌ Magic numbers scattered everywhere
❌ Any feature that works but looks like a 2-hour hackathon demo

#### REQUIRED - ADVANCED CODE LIKE REAL AMONG US:

✅ **Player Character:** Exact Among Us bean shape - rounded capsule body, backpack (separate shape with highlight), visor with sky-blue reflection gradient and white shine, shadow underneath as soft ellipse, color patterns for color-blind accessibility (stripes/dots on body), 2 legs with squash-stretch walk cycle (4-frame animation, leaning into direction), death splits body into two halves with bone visible, ghost has transparent body + floating animation. Hats procedurally drawn on top with proper attachment. Pets with trailing.
✅ **Map Rendering:** Not lines. Draw walls as thick rounded shapes with top highlight + side shadow for 2.5D. Each room has distinct floor color/texture, props - Cafeteria tables with 8 chairs, wires in Electrical with color, MedBay scanner bed, Admin table with card slots, Nav with chairs. Corridors narrow. Background starfield with parallax.
✅ **Animation & Juice:** EVERY state change has animation — vent open/close (3-frame scale), kill stab with red swipe effect, report with large yellow button pulse, emergency meeting with alarm wipe, ejection with lava/space throw, task complete chime with particle burst, progress bar with lerp not jump, camera follow with 0.15 lerp + screen shake on kill/sabotage.
✅ **Minigames Pixel-Perfect:** Each minigame must replicate real Among Us minigame 1:1 — Wiring: colored wires as cubic bezier curves that snap with spark particles when correct; Card Swipe: card with magnetic stripe, you drag at exact speed (too fast/slow fails with shake); Shields: hexagons that light up red on click; etc. With sound, drag physics, error shake, success animation.
✅ **UI is Among Us UI:** Use VT323 / rounded sans font stack, black stroke outline on white text, scalloped buttons with border and shadow, meeting table top-down view with players seated, vote cards stack animation, chat bubbles, not plain divs.
✅ **Code Architecture:** Split logical modules, strict TypeScript types for everything, no `any`, pure functions where possible, small functions (<50 lines), constants file used everywhere, validated protocol, per-player vision filtering actually tested.
✅ **Performance:** 60fps with 12 players, no per-frame allocations, draw only visible, requestAnimationFrame, delta-time independent.

**SELF-CHECKS BEFORE YOU HAND OFF:**
1. Would Innersloth put this in their trailer? If no -> redo.
2. Show to a 12-year-old who plays Among Us - would they say "this looks like Among Us"? If no -> redo.
3. Are there ANY rectangles where there should be sprites? Redo.
4. Did you add sounds? Particles? Shadows? Lighting? If no -> add them.
5. Is your code <100 lines for a major system? You are faking it. Real systems need proper handling of edge cases, animation states, validation, etc.

**If you ship basic code, you have failed the round, even if tests pass. Tests do NOT check visual quality - YOU must enforce it.**

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

### Feel Reference — What REAL Among Us Feels Like:

- Crewmate walk: bouncy, 2 legs alternating, slight body wobble, backpack lags a bit
- Kill: impostor tongue/stab extends, screen briefly darkens, body falls with crack
- Vent: player shrinks into vent with scale + rotation jiggle, vent lid flips open/closed with spring
- Meeting: dramatic klaxon, speed-lines wipe, all players teleported to table with slide animation, ghost floats
- Tasks: tactile, you GRAB wires, you FUEL with hold, you SWIPE card and it shakes if too fast
- Emergency button: big red button with glow, it has 3D bevel
- Maps: The Skeld, Mira HQ, Polus — cluttered with objects, cables on floor, not empty rooms

**If your build doesn't have this level of juice, it's basic. Start over.**

---

## Stack — chosen so it cannot break

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript**, `strict: true` | one language both sides |
| Server | **Node 22 + `ws`** | the only runtime dependency that matters |
| Client | **Canvas 2D + vanilla TS** | no engine to fight; 60fps is easy at this scale |
| Bundler | **esbuild** | one binary, sub-second builds, no config sprawl |
| Transport | **WebSocket, binary-free JSON** | debuggable; bandwidth is not our bottleneck |
| State | **In-memory `Map`** | rooms are ephemeral; a DB adds nothing |
| Tests | pipeline smoke tests + scratch verification | see Verification |

**Dependencies are capped at four**: `ws`, `esbuild`, `typescript`, `tsx`.
Adding a fifth requires a very good reason written into `NEXT.md`. No React, no
Phaser, no Colyseus, no Socket.IO — every dependency is an install that can fail
on another machine and break every later task.

### Project shape — ADVANCED STRUCTURE EXPECTED

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
    │   ├── render.ts     # canvas draw loop - MUST BE ADVANCED (see T16)
    │   ├── input.ts      # keyboard/touch
    │   ├── ui/           # lobby, hud, map overlay, meeting, minigames
    │   └── assets.ts     # procedural sprites (no binary assets) - DRAW REAL CHARACTERS
    └── shared/
        ├── types.ts      # message & entity types used BY BOTH sides
        ├── constants.ts  # speeds, radii, timers — one source of truth
        └── map.ts        # map geometry (T3) → becomes shared/maps/ in T20
```

**assets.ts ADVANCED REQUIREMENT:** This file must contain functions that procedurally draw REAL Among Us characters on Canvas 2D - not circles. `drawPlayer(ctx, color, hat, skin, visor, isGhost, walkFrame, facing)` must draw bean body with stroke outline, backpack, visor reflection gradient, shadow ellipse, legs animation with 4 frames. `drawHat`, `drawBody`, `drawVisor`, `drawPet`. Use bezier curves, gradients, not rect.

### The two commands that must always work

```bash
npm run dev     # esbuild watch + server with reload
npm start       # build client, then serve client + ws on ONE port
```

`npm start` **must** serve the built client and the WebSocket on
`process.env.PORT || 3000`. The pipeline boots exactly this and waits on that
one port. Two ports, or a separate build step, breaks every later task.

---

## Non-negotiable engineering rules — ADVANCED EDITION

1. **The server is authoritative.** The client sends *intent* (`move`, `use`,
   `kill`, `vote`) and renders what the server confirms. Never trust a
   client-sent position, role, or kill.
2. **Never leak secret state.** A crewmate's socket must never receive the
   impostor list, another player's role, or entities outside their vision.
   Filtering happens server-side in `vision.ts`, not in the client renderer.
   This is the single easiest way to ruin the game — treat it as a security
   boundary.
3. **All tuning constants live in `shared/constants.ts`.** No magic numbers in
   game logic. Speeds, cooldowns, radii, timer lengths — one place. If you find yourself typing `100` or `0.5` in game logic, you are doing basic code.
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
11. **[NEW] NO BASIC CODE EVER.** Every visual element must have shadow, highlight, animation, and polish. If real Among Us has it, you replicate it. A plain colored rectangle is never acceptable as a final sprite. Use gradients, strokes (4px black outline like Among Us), bezier curves, and layered drawing.
12. **[NEW] CODE QUALITY = REAL CODEBASE QUALITY.** No 500-line functions. No copy-paste. Proper TypeScript strict types, discriminated unions for messages, no `any`. Each file max ~400 lines, split logically. Comments only where needed to explain non-obvious logic, not to apologize for hacks.
13. **[NEW] EVERY FEATURE IS FULLY ANIMATED AND AUDIO-VISUAL.** If you add kill, add kill sound + kill animation + body falling + report glow + cooldown dial UI with sweep. If you add vent, add vent lid flip + particle poof + sfx + visibility logic. Nothing pops instantly. Everything tweens.
14. **[NEW] MINIGAMES ARE REAL GAMES, NOT BUTTONS.** Each minigame must be at least 150+ lines of interactive logic, have draggable elements, success/failure states, error feedback (shake), success particle burst, and be winnable only through actual interaction - not a button that says "Complete".
15. **[NEW] MAPS ARE SKELD-QUALITY, NOT GRID.** Real Among Us maps have irregulated walls, rounded corners, props, wires, panels, and feel like a spaceship. Your map must have 8+ rooms each with unique props drawn procedurally, corridor width varying, vent positions hidden inside floor details.

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

## Task list — WITH ADVANCED BARS

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
- `app/public/index.html` + `style.css` — **ADVANCED: Not basic dark theme. Real Among Us styled landing page** - dark space background with parallax stars (canvas or CSS), Among Us logo stylized (big rounded white text with black stroke), crewmate silhouette decorations, loading spinner that's a spinning crewmate. Lobby panel with rounded corners, black border, inner shadow, like Among Us UI. CSS must include VT323 font import, proper animations.
- `app/src/client/main.ts` — connects socket, logs `open`, handles reconnect with UI.
- `app/.gitignore`: `node_modules/`, `public/bundle.js*`, `.env`.

**ADVANCED BAR FOR T1:** Even this skeleton must FEEL like Among Us from first load. Index.html must not be bare `<canvas>`. It should have a styled loading screen, starfield background, proper viewport meta, and look like a game menu, not a dev test page. Build must produce sourcemaps.

**COMMIT this test** — `app/tests/health.test.js`: health returns 200 with
`status === 'ok'`; `GET /` returns HTML; `GET /../package.json` does not return
source.

---

### T2: Rooms, join/create & lobby state
**STATUS: TODO**

**Requirements**

- `shared/types.ts` and `shared/constants.ts` seeded with protocol above
  and initial tuning values. Constants must have REAL Among Us values: CREW_SPEED=2.0, IMPOSTOR_SPEED=2.2, KILL_RADIUS=1.5, VISION etc.
- `server/rooms.ts`: `createRoom(hostName)` → unambiguous 4-letter code
  (no `I`,`O`,`0`,`1`), `joinRoom(code,name)`, `leaveRoom`, `getRoom`,
  `listPlayers`, `destroyRoom`. Max 12 players; duplicate names get numeric
  suffix. **Advanced: Room codes use weighted letter distribution to avoid profanity, include room TTL, cleaning interval.**
- `server/protocol.ts`: `parse(raw)` → validated `ClientMsg` or `null`.
  Reject unknown `t`, wrong field types, oversized payloads (>4 KB), and
  names outside 1–16 printable. **Must validate every nested field, not just t.**
- On membership change, broadcast `joined`/`snapshot` to room with proper filtering.
- Host is first player; if host leaves, longest-present promoted with notification.
- Rooms self-destroy when empty.

**ADVANCED BAR FOR T2:** Lobby UI must be Among Us lobby - players displayed as bean characters walking around? At minimum list with color swatches, hat icons, ready indicators with real Among Us styling. Room code large with copy button that has bounce animation. Join/Create flow with animations, error shake for bad code. Not a bare form.

**COMMIT this test** — `app/tests/lobby.test.js`: two WS clients join same code and both observe player count 2; joining nonexistent code returns `error` not disconnect.

---

### T3: Map geometry & collision
**STATUS: TODO**

This is where basic agents fail hardest. A few rectangles = FAIL.

**Requirements**

- `shared/map.ts`: hand-authored map as DATA, but **must be detailed like Skeld**. ADVANCED SPEC:
  - Walls as line segments (~150+ segments, not 20), with rounded corners logic
  - 8 named rooms: Cafeteria (large central with 2 tables x 8 chairs each, dotted floor), Reactor (manifolds with reactor symbol), Electrical (L-shaped with 8 wire panels along walls), MedBay (2 beds + scanner, clean white floor), Navigation (pilot chairs, curved windows), Storage (fuel canisters stacked), Shields (hexagon floor texture), Admin (large table with 12 card readers), Security (4 monitors), Upper Engine, Lower Engine, Weapons (asteroid clearing seat)
  - Corridors: varying width, not uniform; 90-degree turns with chamfer
  - 14+ vent nodes forming network similar to Skeld (not 4), with links => Cafeteria→Admin→Corridor, etc.
  - Named task locations (20+ locations): `cafeteria_wires`, `electrical_divert`, `medbay_scan`, `nav_chart`, `shields_prime`, `storage_fuel`, `weapons_asteroids`, etc. Each task location has x,y + interactRadius + kind supported
  - Spawn points spread across Cafeteria
  - Emergency button at Cafeteria center table
  - Camera points at 6 locations
  - Sabotage fix points: Reactor has 2 handprints, Oxygen has 2 keypad panels in Admin and O2, Lights in Electrical panel, Comms in Comms room
- `server/movement.ts`: `step(player, dx, dy, dt)` with **circle-vs-segment collision AND wall sliding** (not stopping dead). Must handle sliding along wall by decomposing velocity into normal/tangent. Speed from constants. Use continuous collision to prevent tunneling. Handle ghost no-clip.
- `roomAt(x,y)` → named room containing point, via point-in-polygon or nearest room bounds, handled accurately even near walls.
- Client renders walls and rooms from SAME `shared/map.ts` — map defined once. **Render must draw walls as 2.5D with height**: thick wall top + vertical face in darker shade + shadow casting. Floor textures per room (dots/lines). Props procedurally drawn.

**ADVANCED BAR:** If you render map as `ctx.strokeRect`, you failed. You must draw each wall as polygon with stroke outline + fill + top highlight. Rooms must have props drawn (tables as rounded rects with legs, chairs). Provide top-down feel like real Skeld minimap but fullsize. Collision must feel smooth — player should not get stuck on wall corners.

**Verify (do not commit test)** — prove player cannot cross wall, slides rather than sticks, `roomAt` returns right name. Test with diagonal movement into corner.

---

### T4: Real-time movement & interpolation
**STATUS: TODO**

**Requirements**

- Fixed 20Hz server tick broadcasting `snapshot` per-vision-filtered with each player's position + velocity + facing + walkAnimFrame.
- Client sends `move` intent at most 20/sec; server clamps to unit vector and applies own speed — client cannot move faster by spamming. **Server must validate vector length <=1 + epsilon and normalize.**
- `client/net.ts` buffers last two snapshots and interpolates render positions with **lerp + extrapolation with clamping**; includes clock offset measurement; handles packet loss with smoothing.
- `client/render.ts` draws at `requestAnimationFrame` with deltaTime, **y-sorted draw order** (lower y draws front), camera lerp follow (0.12), deadzone, map clamped to viewport.
- Smooth camera follow with starfield parallax (background moves at 0.3x).
- Keyboard (WASD/arrows) **with diagonal normalization** and on-screen touch joystick **with dynamic origin (appears where finger touches left side), deadzone 20px, and visual stick + base that scales with pressure**.

**ADVANCED BAR:** Movement must feel like Among Us - acceleration/deceleration curves (ease from 0 to max speed in 80ms), squash-stretch on walk (body scales x/y slightly), legs animation at 8fps while moving, lean into direction by 8 degrees, stopping has skid frame. Camera must have screen shake support. Joystick must be large, thumb-friendly, with active zone visualized. No teleporty movement; interpolation must hide tick jitter.

**Verify (do not commit)** — with two tabs, both see each other move within ~100ms and client spamming move at 200Hz does not travel faster. Also verify y-sorting makes front player occlude.

---

### T5: Roles, game start & the kill loop
**STATUS: TODO**

**Requirements**

- Host starts game with ≥4 players. Impostor count from settings (1 for 4–6, 2 for 7–9, 3 for 10–12), assigned by **cryptographic shuffle (crypto.getRandomValues) not Math.random**.
- `SelfView.role` sent ONLY to that player. Verify raw frames crewmate never sees impostor list. **Must not leak via roomView or task list.**
- Impostor `kill` requires: target alive, within `KILL_RADIUS`, cooldown elapsed, not in meeting, has line-of-sight (not through wall - check vision), not shielded (T11), not same team. Produces body: positioned at victim pos with angle of killer, color preserved, has half-body sprite, report highlight pulse.
- Killed players become ghosts: see everything, move through walls (no collision), still complete tasks, cannot vote/chat with living but ghost chat works, **transparent sprite with float y = sin(time) bob**.
- `report` on nearby body triggers meeting; body has large glow ring when reportable.
- Per-map spawn points and **3-2-1 start countdown with Among Us style**: big number with scale pop animation, sound beep, camera zoom.
- **Role reveal splash:** Full-screen modal like real Among Us: "You are a Crewmate/Impostor" with color of role (blue/red), your character large in center, for impostor also shows fellow impostors with names + color small cards. Types text char-by-char, plays dramatic sound. Driven entirely by SelfView. Button to close that enables movement. Must not be assembled from data others received.
- Kill cooldown starts after reveal, resets after every meeting, visible as cooldown dial on kill button.
- **Venting (impostor only):** `vent` enters nearest vent node when within `VENT_RADIUS`, anim sequence: vent lid flips open (scaleY animation), player shrinks into hole with poof particle (10 white dots outward), disappears. Moves between **linked** nodes only via vent UI (grid of vent spots like Among Us - show map of vents), exits only at node with lid flip + grow. While vented player is **invisible to everyone (absent from snapshots, not merely undrawn)**, cannot kill, cannot be killed. Entering/exiting play animation visible to anyone with LOS at that vent — core tell. **Engineer later reuses this but this task must make base venting polished.**

**ADVANCED BAR:** Kill must have dramatic feedback - red vignette flash, screen shake 4px, kill sound (WebAudio sawtooth stab), body falling animation (rotation + blood splatter particles). Role reveal must look like real Among Us with dark background, spotlit character. Vent must be satisfying - not instant disappear but animated sequence with particles + sound. Ghosts must have distinct visual - desaturated + transparent + blur trail.

**COMMIT this test** — `app/tests/roles.test.js`: start 4-player game assert crewmate's received messages never contain another player's `role`, and kill outside KILL_RADIUS is rejected.

---

### T6: Vision, line-of-sight & ghosts
**STATUS: TODO**

**Requirements**

- `server/vision.ts`: `visibleTo(player, room)` → filtered `PlayerView[]` using radius from constants (impostors see 1.5x further) **plus wall occlusion via raycasting** — you cannot see through wall. Implement: for each candidate, cast ray from viewer to target, check intersection with wall segments (Bresenham or line-intersection). If blocked, not visible. Also check distance^2 vs radius^2. Ghosts see all. Dead bodies visible within radius regardless of occlusion? No, must respect walls.
- Snapshots built **per recipient**. Player outside vision absent from snapshot, not merely undrawn.
- Client renders **soft vision cone/circle mask** - not hard circle. Real Among Us has fog: draw black overlay with radial gradient cut-out (inner radius clear, outer 20% feather). Also add **light pools** under ceiling lamps (warm yellow radial). During lights sabotage, radius reduced to 40%, impostor keeps larger radius. Use canvas composite `destination-out` for mask.
- Ghosts see full map and other ghosts; living never see ghosts. Ghosts have X-ray vision: no fog.

**ADVANCED BAR:** Vision must not be just distance check. You must implement wall raycasting - player around corner cannot see. Feasible: precompute spatial grid. On client, vision mask must be smooth with gradient, not jagged. Add vignette. Show how vision changes when lights sabotaged - sudden dark with emergency flashlight. Impostor vision slightly reddish edge.

**COMMIT this test** — `app/tests/vision.test.js`: two players different rooms not in each other's snapshots; when adjacent they do. Also test wall blocks even if close.

---

### T7: Tasks & progress bar
**STATUS: TODO**

**Requirements**

- `server/tasks.ts`: assign each crewmate N tasks (from settings) across distinct map locations. Task kinds: `short` (1 step), `long` (2-3 steps), `common` (identical for everyone, like fix wiring or swipe card). Ensure distinct locations where map allows; common tasks separate setting. **Real distribution:** 1-2 common, 2-3 short, 1 long per player. Randomize per player but no duplicates.
- `taskStep` validates proximity to task location (within 2 units), correct step order, phase=playing, alive (ghosts can finish but not for win? actually ghosts can complete but they don't affect? In real Among Us ghosts complete speeds up - here ghosts can complete remaining). Must check task belongs to player.
- Global progress = completed steps ÷ total steps across **crewmates only**; broadcast on every change with tweened animation on client. Impostors see progress bar that never advances from own actions (but they see real progress? In real Among Us impostors see same progress - but ambiguous. Spec says never advances from their own actions - meaning they have no tasks).
- Visual tasks list per player stored, shared.
- Crew win when progress 100%.

**ADVANCED BAR:** Task assignment must be smart: avoid giving two tasks in same room if possible, spread across map to force movement, respect `mapDef.taskLocations` which lists supported kinds per location. Steps for long tasks require returning to same location. Task use key must trigger proper interaction range detection on server (not client). Progress bar in HUD must animate with lerp and have Among Us styling - green fill with black stroke, white percentage? On hover show tasks list.

**Verify (do not commit)** — complete task from wrong location rejected; complete all tasks progress maths right; test ghost can complete; impostor cannot complete (rejected).

---

### T8: Task minigames
**STATUS: TODO**

This task is where you prove you can build REAL Among Us.

**Requirements**

- `client/ui/minigames/` with **at least six fully polished**, canvas/DOM, no assets, **each 150+ lines, each feels like real Among Us task**:
  1. **Wiring (Fix Wiring):** 4 colored wires left-to-right, each draggable. Right side shuffled. Dragging draws thick bezier curve from start to cursor with glow + spark particles when over correct target. When connected, wire snaps + electric spark animation + sound chime. All 4 must match.
  2. **Keypad/Code Entry (Download/Prime Shields style):** Security code display 4-digit, player must type matching code on keypad - buttons have press animation (scale 0.9), correct digit lights green, wrong shakes red + error buzz. 3 attempts? No, infinite but tracks.
  3. **Asteroids (Clear Asteroids):** Spaceship at bottom, asteroids of random shape/size drifting down with rotation. Clicking shoots laser (white line + flash) towards click pos; if hits asteroid, it explodes into 8 particles + flash. Must destroy 20. Has crosshair, spaceship moves slightly.
  4. **Card Swipe (Admin - Card Swipe):** Card sits in wallet bottom, must drag up slow across reader. Speed measured - too fast (<400ms) or too slow (>1200ms) or not straight enough = fail with red light + shake. Good swipe = green light + chime. Real Among Us has worst swipe - replicate that frustration accurately.
  5. **Fuel-Hold (Fuel Engines):** Hold button to fuel, fuel gauge climbs with wobble, but you must hold without releasing; if release early, it drains slightly; particle fuel flow animation from can to engine. Mouse/touch hold with progress.
  6. **Alignment/Chart Course (Chart Course / Align Engine):** Drag ship marker or rotate rings to align target - have two layers, one fixed target ghost, one draggable with momentum, must align within 5 degrees, snap when close with haptic feedback simulation (screen shake).
  Plus optional but you should try: **Inspect Sample (MedBay)** with anomaly selection, **Empty Garbage lever** pull with hold.
- Each reports completion via `taskStep`; server source of truth — client cannot mark complete without interaction **must validate step number**.
- Fully keyboard-operable, touch-friendly with large tap targets.
- **Visual tasks (toggleable):**
  - Requirements: tasks that play world-space animation *other players can witness* proving innocence:
  `Empty Garbage` (chute lever in Storage: lever pulled => garbage bag trash animation ejects from chute bottom into space, visible to others nearby),
  `Prime Shields` (ship's shield hexagons around map exterior light up one by one cyan cascade, visible from anywhere if in vision),
  `Clear Asteroids` (turret in Weapons fires lasers visible as `visual` messages: `visual: {kind:'turret_fire', playerId, dir}` broadcast to everyone with LOS),
  `Submit Scan` in MedBay (full-body scanner bar takes 10 seconds, green scan lines go up/down over player body, locks player in place, cannot move during).
  Animation broadcast to everyone with LOS, **not** just player. Impostor faking visual gets no broadcast — classic detection method.
  Client receiving `visual` draws world-space animation over player: shield particles, garbage chute opening, turret flash.

**ADVANCED BAR:** Each minigame must have: title bar like Among Us (dark panel with "TASK" etc), close button, instruction text, background that looks like the machine (metallic gradients), animated parts, sound effects via WebAudio (chime, error buzz, click), and must be impossible to autocomplete without proper interaction (e.g., wiring requires checking color match server-side or client has to drag near target within radius). Not "Click to win" - needs drag, hold, timing.

**Verify (do not commit)** — play each to completion confirm progress; close early no progress; impostor faking visual produces no broadcast.

---

### T9: Sabotage system
**STATUS: TODO**

**Requirements**

- `server/sabotage.ts`. Kinds: `lights` (reduces crew vision to 40%, impostor keeps 90%, fix at Electrical panel requiring flipping 5 switches up), `comms` (hides task list, admin, cameras, door log; fix by turning knob in Comms), `oxygen` and `reactor` (**critical** — countdown 30-45s that ends game for crew if expires, plays loud klaxon + red screen pulse, requires **two players simultaneously** at two different panels), `doors` (temporarily seals a room for 10s, blocks passage via collision override, auto-expires).
- Only impostors sabotage; global cooldown 30s + per-kind cooldown; only one active at a time; critical blocks emergency button.
- Fixing requires crewmates at correct location — criticals need two players at two diff panels simultaneously (check both players present within radius each tick). Show HUD directional arrows to fix points + distance.
- `doors` cannot be fixed by crew — expires on timer, shows locked door sprite with red X.
- Sabotage menu for impostor offers only kinds current map declares (see T20); sabotage kind map does not have rejected.
- HUD shows active sabotage banner + countdown with red flashing, map highlights fix points with pulsating icons.

**ADVANCED BAR:** Sabotage UI must be Among Us style - big red grid with icons for each sabotage, click to trigger with confirmation animation. Fixing interaction must replicate real game: lights - toggle switches mini puzzle where each switch animates flip with click; reactor - handprint scanner where you must hold hand for 3s alongside another player, both handprints glow green when both present. Countdown must sync across clients via server time (not client clock). Play klaxon sound loop + red vignette pulse on HUD. Doors sealed must change collision dynamically - movement.ts must check active door sabotage.

**COMMIT this test** — `app/tests/sabotage.test.js`: crewmate attempting sabotage rejected; critical sets countdown; second sabotage during active rejected; non-host trying doors blocked.

---

### T10: Surveillance — Admin, Cameras, Vitals & Door Log
**STATUS: TODO**

The information systems that make deduction possible. Without these the game is guesswork; with them, players build real cases.

**Requirements**

- `server/surveillance.ts`, all **server-filtered** — client must never receive data it has not physically walked to a console to obtain. Console entry/exit proximity check.
- **Admin table** (Admin room): live map showing *count* of players per room, never names. Uses `roomAt()`. **UI:** Top-down minimap of rooms with numbers inside each room (green text), similar to real Admin. Blinks every 1s, slightly CRT noise.
- **Security cameras** (Security room): view 4 fixed camera positions showing players within each camera's radius (filtered snapshot). While *anyone* watching cameras, red blinking light appears on those cameras for players in the room — classic tell. **UI:** 4 camera feeds in 2x2 grid, each feed is small live view (re-render mini map + dots for players), with scanlines, slight fisheye, timestamp, REC red dot blink. Player list not shown - just dots movement.
- **Vitals** (MedBay): panel listing every player as `alive` or `dead`, with color circle + pattern + name, dead shows only once kill happened, giving timing signal. Also shows `OK` green or `DEAD` red with heartbeat line that goes flat on dead. Update every tick.
- **Door Log** (Communications): timestamped list of last N (20) room entries/exits, `{ time, playerColour, room, direction }` — colour + pattern, not name. Eg "Red entered Cafeteria". Timestamp formatted mm:ss into round.
- Each console requires proximity to use and closes when walk away (server checks distance each tick; if far, sends close).
- **`comms` sabotage disables Admin, Cameras and Door Log** (not Vitals); `lights` sabotage reduces what cameras show (smaller radius, noise).
- **ADVANCED VISUAL:** Consoles have monitor bezel, scanlines, glow, CRT curvature via CSS filter or canvas overlay. Camera red light blinking when watched: small sprite above Security cameras that animates ON/OFF (real tells).

**COMMIT this test** — `app/tests/surveillance.test.js`: player far from Admin who requests admin data rejected; player at Admin receives room *counts* with no player names/ids; after kill Vitals reports exactly one dead.

---

### T11: Extended roles — Engineer, Scientist, Guardian Angel, Shapeshifter
**STATUS: TODO**

Optional roles, each toggleable in settings with probability and count. All role state secret server-side.

**Requirements**

- `server/roles.ts` — role registry so later tasks add roles without editing game loop. Pattern: `RoleDef { id, team, probability, max, onAssign(player), canUseAbility(player, ability), handleAbility(...) }`. Must be extensible without modifying game.ts core.
- **Engineer** (crew): may use vents, with per-game or cooldown-limited duration (eg 25s total vent time). Full vent access from T5, but crew-aligned — venting as crew still makes blinking light? No but still suspicious. Use same vent animation but blue tint.
- **Scientist** (crew): may check Vitals from anywhere via personal battery that depletes while open (5s per full charge) and recharges over 10s while closed. Battery UI as circular fill.
- **Guardian Angel** (ghost): may shield one living player for short duration (10s) on cooldown (60s); shielded player survives one kill attempt. Impostor sees attempt fail (shield flash + rejection). Shield visualization: glowing egg forcefield around player with hexagonal pattern, pulses.
- **Shapeshifter** (impostor): may take another player's exact appearance (colour, hat, name, pet) for duration (30s) on cooldown (30s). Shifting and reverting visible **only** to anyone with LOS at that moment (broadcast `visual` shift). While shifted, name/colour in snapshots is disguised but server remembers real identity for final reveal. Leaves trace evidence.
- Role assignment respects counts and never assigns two roles to one player, never makes impostor also Engineer etc. Respects impostor count overlap: Shapeshifter counts as impostor.
- End-of-game reveal shows every player's role, not just impostor/crew — big role cards.

**ADVANCED BAR:** Each role ability needs custom animation and sound: Engineer vent - blue particles different from impostor red; Scientist vitals - tablet flip animation with battery draining bar; Guardian Angel shield - dramatic angel wings flash when shielded, sound angelic chime; Shapeshifter shift - body morph animation (scales distort, colors swap with swirl particles, name dissolves). Shield breaking on kill must show cracked shield particles.

**COMMIT this test** — `app/tests/extendedroles.test.js`: with Guardian Angel enabled, shielded player survives kill and impostor cooldown resets; Shapeshifter's shift from non-shapeshifter rejected.

---

### T12: Meetings, discussion & voting
**STATUS: TODO**

**Requirements**

- `server/meeting.ts`: triggered by `report` (near body) or `meeting` (emergency, limited per player per game (1-3), with cooldown after game start 15s).
- Emergency meeting requires standing at emergency button (per-map position, T20) and refused while critical sabotage active or while caller is dead, vented, in minigame. Must check distance server-side.
- Phases with timers from settings: discussion (60-120s) → voting (30-120s) → reveal (5-10s). All players teleport to meeting table with slide animation; movement frozen during meeting.
- Text chat during discussion, living only; ghosts separate ghost channel visible only to ghosts — verified by inspecting living player's raw frames (must never contain ghost chat). Chat with bubbles, color-tagged names, timestamps, rate limit.
- One vote per living player, changeable until timer ends; skip allowed. Tally hidden until reveal (configurable), ties no ejection. When anonymous, tally shows counts without revealing who voted whom.
- **Quick Chat:** fixed phrase list ("Where?", "I saw <colour> vent", "<colour> is sus", "Skip", "I did <task> in <room>") composed from menus so game playable without typing. Free chat toggleable. Phrase builder with two dropdowns dependent.
- Dead players chat visible only to dead — verify.
- Ejection reveals whether impostor (configurable) and checks win conditions. **Ejection animation:** player ejected into lava/space with slow tumbling, text "X was/was not The Impostor" with drumroll.

**ADVANCED BAR:** Meeting screen must be EXACT replica of Among Us meeting - top-down view of meeting table oval with players seated around (12 positions precomputed around ellipse), your player at bottom, dead bodies as ghosts floating, report reason at top, UI panels: chat left, player list center around table, voting buttons. Voting: when you vote, a small card flies from you to voted slot with animation. Discussion timer circular progress. Emergency button must have obvious press animation + sound. Report must show who reported which body (name). Use Among Us fonts, colors, buttons.

**COMMIT this test** — `app/tests/meeting.test.js`: three clients meet, two vote same player, that player ejected and remaining receive `ejected` with correct id.

---

### T13: Win conditions, round flow & spectating
**STATUS: TODO**

**Requirements**

- Continuous evaluation after every kill, ejection, task completion and sabotage expiry: crew win by tasks or ejecting all impostors; impostors win on parity (impostors >= living crew) or critical sabotage expiry.
- `ended` reveals all roles + reason + stats (tasks done, kills, etc); results screen shows who was who with role cards, victory banner (green for crew, red for impostor) with animation.
- Host can start new round same players; roles reshuffle and state fully resets — **no leakage from previous round** (positions, tasks, cooldowns, bodies, votes cleared).
- Ghosts spectate freely and correctly become living next round. Ghost movement speed 1.5x, can pass through walls.

**ADVANCED BAR:** Victory/defeat music stingers, confetti/crowd particles, stats screen lists tasks completed per player, ejection sequence after win shows roles. New round must have 3-2-1 countdown again. No lingering bodies or closed doors. Round reset must be atomic - either all reset or none.

**COMMIT this test** — `app/tests/winconditions.test.js`: with 1 impostor 1 crewmate, kill produces `ended` with `winner:'impostor'`; fresh round resets phase lobby.

---

### T14: Lobby, settings & customisation
**STATUS: TODO**

**Requirements**

- Lobby UI: room code big with copy button bouncy animation, player list with ready states (ready button with check animation), host-only start button (needs min players) with shake if not enough, players displayed as bean characters with hats/pets walking around lobby idle? At least show character preview.
- Host-editable settings, validated server-side and broadcast to everyone: impostor count, crew/impostor speed (0.5-3x), vision radii, kill cooldown/radius, emergency meetings count, discussion/voting seconds, tasks per player (short/long/common counts), confirm-ejects, visual-tasks on/off, anonymous votes, map id (T20), max players, public/private lobby (T18), AFK timeout, reconnect grace period. **Each setting has slider or stepper with Among Us styling. Validation: reject out-of-range, impostorCount >= maxPlayers illegal etc.**
- Player customisation, **procedurally drawn** (no binary assets): 12 colour-blind-safe colours each distinct pattern (stripes, dots, etc), ~10 hats (cowboy, cap, crown, plant, etc shaped with bezier), ~6 skins (lab coat, suit, etc), ~4 visors (goggles...), ~4 pets (hamster that follows with easing trail 0.15, lagging, mini-me, etc). Cosmetics cosmetic only. Colours unique per room; taken colours show unavailable greyed + cross.
- Task bar mode (setting): `always` / `meetings only` / `never`.
- Settings persist localStorage.

**ADVANCED BAR:** Lobby must not be HTML form dump. Design like Among Us lobby - laptop screen with settings tabs, sliders that look like game UI (rounded track, knob with shadow). Customization panel shows character large central, colour grid 3x4 with pattern previews, hats carousel with left/right arrows, each hat icon drawn procedurally mini. Use localStorage but also sync to server via `cosmetic` message. Ready state must be toggle with character raising hand animation? At minimum checkmark bounce.

**Verify (do not commit)** — change every setting and confirm effect next round; non-host cannot change settings even by sending message directly (test server rejection).

---

### T15: Reconnection, resilience & anti-cheat
**STATUS: TODO**

**Requirements**

- Disconnected player grace period from settings to rejoin same identity and resume role/tasks/position. Store disconnecting timestamp, keep player ghost? Not ghost, but frozen for 30-60s. If rejoins within grace, restore socket, send catch-up snapshot + tasks + role.
- Heartbeat ping/pong every 10s; drop sockets that stop responding (no pong in 30s). Server sends `ping {at: Date.now()}`.
- Rate-limit every message type per socket (token bucket: chat 2/sec, move 20/sec, kill 1/sec, vote 1/sec); kick on sustained abuse (send `kicked` then close).
- Reject impossible input server-side: out-of-range movement deltas (> speed*dt*2), kills through walls (raycast), votes from dead, task steps from across map (distance check), sabotage in lobby, etc. Log each rejection with player id + reason.
- Phase gating validation: movement during meeting rejected, votes outside voting window rejected, sabotage in lobby rejected, task steps after game ends rejected — all logged, not crash.
- Room survives host leaving mid-game (promote longest).
- **Anti-cheat logs** written via console.warn with structured JSON.

**COMMIT this test** — `app/tests/resilience.test.js`: socket disconnects rejoins within grace keeps player id; flood 1000 messages results rate limiting not crash.

---

### T16: Audio, polish & feel
**STATUS: TODO**

**Requirements** — THIS TASK MUST TURN BASIC LOOK INTO REAL GAME LOOK.

- **Procedural audio via WebAudio — no binary assets:** footsteps (filtered noise with pitch variation per step), kill sting (sawtooth slide down + sub bass), meeting alarm (two-tone klaxon loop), sabotage klaxon (fast beep + red alert), task-complete chime (sine arpeggio C-E-G), vote blip, vent poof (white noise burst with bandpass), button clicks, shield pop, etc. Global mute persisted localStorage + mute button that shows slashed speaker.
- **2.5D depth rendering — mandatory advanced implementation:**
  - **Y-sorted draw order:** entities lower on screen draw front, correctly occlude props and each other. Must sort playerViews + bodies + props by y each frame.
  - **Soft drop shadows:** under every player: ellipse 30x12, rgba(0,0,0,0.35), blur via shadowBlur or gradient, scaled by walk frame (squash), offset by light angle.
  - **Parallax:** background starfield layer (200 stars with twinkle) scrolls slower than map (0.3x camera), deeper stars slower (0.1x).
  - **Wall height illusion:** each wall segment drawn as top edge (light color #444) + vertical face (darker #222) 8px tall with shadow, plus top line highlight.
  - **Layered lighting:** dark overlay with radial cut-out for vision (inner clear 100%, outer gradient 0% over 40px), plus warm pools under ceiling lamps (drawn as yellow radial gradients multiplied via `globalCompositeOperation='lighten'` or similar) — this single effect makes flat map feel spatial.
  - **Squash-and-stretch:** walk cycle scales body y 5% smaller when leg extended, x larger, lean 5 degrees into movement direction via canvas rotate.
- **Visual polish:** walk animation 4 frames legs alternating, kill animation - impostor lunges forward 0.2s with red slash trail, body sprite - half body with bone, separated legs, visor cracked. Vent open/close - lid rotates scaleY, hinge. Meeting transition wipe - radial wipe or speedline wipe covering screen in 300ms. Damage vignette during criticals - red border pulse `sin(time*5)`.
- **Responsive layout:** canvas + overlays scale 360px-wide phone portrait to desktop, honouring safe-area insets, touch controls reposition portrait; nothing important under thumb (joystick left bottom 80px above edge, action button right bottom). Use `dvh` units, handle resize.
- Nothing flashes >3Hz; `prefers-reduced-motion` disables shake and wipes (respect media query).
- Performance: 60fps 12 players mid-range laptop. Draw only what is visible (cull outside viewport + vision); no per-frame allocation in render loop (preallocate arrays, avoid `filter`/`map` creating new arrays each frame; reuse). Use offscreen canvas for static map layer cached.

**ADVANCED BAR - THIS TASK IS 100% VISUAL QUALITY:** If after your code, game still looks like colored squares on grey background, you failed. Must add: shadows, lighting, wall depth, walk cycle, particle systems (shared particle pool: kill needs 12 blood particles, vent needs 10 dust particles, task complete 8 sparkles). Audio must be synthesized procedurally with WebAudio oscillators - not silent.

**Verify (do not commit)** — 12 simulated players frame budget holds; mute persists reload; test prefers-reduced-motion disables shake; confirm shadows draw.

---

### T17: HUD, interaction layer & ghost UX
**STATUS: TODO**

The plan builds correct simulation but never specifies screen player actually looks at. This task is that screen. It becomes playable rather than merely running.

**Requirements**

- `client/ui/hud.ts` — persistent in-game layer, drawn from server state only (rule 8):
  - **Task list panel** top-left like Among Us: styled panel with rounded corners, black stroke, list with per-task room + name, struck through on completion (with checkmark icon), hidden/shown per task-bar setting. Shows tasks counter "Tasks: 2/5". Animates completed tasks sliding out with fade.
  - **Global progress bar** bottom like Among Us but top? In Among Us it's top total. Animated between values with lerp (green fill with black stroke, white text %).
  - **Context action button** (`use`) that names thing standing on — `Use Admin`, `Fix Wiring`, `Report Body`, `Emergency Meeting` — greyed when out of range with same keybind desktop (`E`) and large thumb target touch (64px). Button has Among Us styling: rounded with border + shadow, icon.
  - **Kill button with radial cooldown dial** for impostors, plus separate `Sabotage` and `Vent` buttons; all three disabled with visible reason rather than silently doing nothing (e.g., "Cooldown: 5.3s", "Too far", "Not impostor"). Kill button red with knife icon, cooldown radial sweep mask clockwise, text in center.
  - **Sabotage banner + countdown** top-center red bar flashing, plus directional arrows pointing to fix points (e.g., 2 red arrows on screen edge pointing to Reactor). Arrows pulsate.
- `client/ui/mapoverlay.ts` — full-screen map, opened Tab/button, showing rooms outline, your task markers (! yellow icons), for impostor sabotage menu button grid wired to same targets. Opening does NOT pause game; map semi-transparent over game, you can still move? In Among Us you can move while map open (small map). This should be draggable minimap + fullscreen toggle.
- **Countdown clock sync:** `net.ts` measures offset between server/client clocks from `ping`/`pong` and every timer renders against offset. Skew client clock 30s must still read correctly. Use exponential moving average for offset.
- **Ghost UX:** desaturated palette (filter grayscale 30%), ghost-only chat channel indicator (cyan border), remaining tasks panel still usable but ghost tasks label "Ghost Tasks", clear "you are dead — you can still complete tasks but not vote" banner top, ghost float animation, ability to noclip hint.
- **Death/ejection sequences:** victim sees kill cam (brief red screen then black with "You were killed by [color]" + respawn as ghost), everyone sees ejection animation with configured confirm-ejects text.
- Every button reachable keyboard with visible focus ring, accessible name.

**ADVANCED BAR:** HUD must replicate Among Us HUD layout exactly - tasks top-left, settings gear top-right, map button bottom-right (with mini-map preview), use button bottom-right above map, kill/sabotage/vent buttons centered bottom in stack, progress bar bottom horizontal? Check real Among Us screenshots. Buttons must have icons drawn procedurally (kill knife icon). Must have among us font (Nunito/rounded), black outline text.

**Verify (do not commit)** — walk to console confirm context button names + greys when away; skew client clock 30s confirm sabotage countdown correct; impostor kill button shows reason when disabled; ghost palette desaturated.

---

### T18: Public lobby browser & quick join
**STATUS: TODO**

A 4-letter code only works if you already have friends online. Without this the game is empty for solo visitor, which is most common first experience.

**Requirements**

- `server/browser.ts`: registry of rooms whose host set them **public** in settings. Private default and private never listed. Registry auto-prunes closed rooms.
- `GET /api/lobbies` → array of `{ code, hostName, players, max, mapId, impostors, phase }` for public rooms lobby phase only. No player ids, names beyond host's, never mid-game room.
- `quickjoin` picks fullest joinable public lobby, creates new public room if none — one click front page to game. Must atomically join.
- Lobby browser UI lists rooms with refresh button spinning anim, shows card per room: map thumbnail (mini procedural), host name, players/max bar with dots representing crewmate colors, map name, impostor count. Friendly empty state with illustration + `Create room` CTA with bounce.
- Room disappears list moment it starts, fills, empties.

**ADVANCED BAR:** Lobby browser must look like Among Us public list style - dark panel with row items each rounded with hover highlight. Quick join button big prominent "FIND GAME" with Among Us styling, pulse glow animation. Thumbnail map drawn mini canvas same as big map but tiny.

**COMMIT this test** — `app/tests/browser.test.js`: private room not appear in `/api/lobbies`; public room does and shows correct player count; `quickjoin` with no public rooms creates one and returns `joined`.

---

### T19: Moderation, AFK & text safety
**STATUS: TODO**

Any game with strangers and chat box needs this, retrofitting after protocol freezes far more expensive than building now.

**Requirements**

- `server/moderation.ts`. Host may `kick` (removable, may rejoin) and `ban` (code-scoped, cannot rejoin life of room) any other player. Kicked socket receives `kicked` with reason before close. Host cannot kick self. Ban list per room with timeout? Permanent for room lifetime.
- **Vote-kick during lobby only** as fallback when host is problem: majority lobby removes player (votes tracked, if >50% of present players vote kick same target, kick). Uses same `mod` message with `votekick`.
- **AFK handling:** player with no input for settings timeout (default 60s) marked AFK (icon above head: zZ), if game running auto-skipped in votes (vote not counted, skipped), after second timeout (120s) removed so cannot stall forever. Server tracks `lastInputAt` per player (move/use/chat/vote).
- Chat safety on free-text channel: length cap 120, rate limit 2/sec burst 5, control- and zero-width-char stripping (regex), naive profanity filter with list ~50 common English profanities plus leet variants (replace `*`?), host-toggleable setting `profanityFilter`. Player **names** go through same filter at join (reject or censor). Log filtered attempts.
- Leaving mid-game must not corrupt state: leaver's tasks come out of denominator (recalculate progress), win conditions re-evaluated immediately (if impostor left may cause crew win), bodies remain? Yes remains.

**ADVANCED BAR:** AFK indicator must be visual - zZ floating above head animation, plus grayed name in meeting. Vote-kick UI must show vote count. Moderation messages in chat system-styled (yellow). Filtering must not break valid names like "assassin" naive; need word boundaries. Profanity list configurable.

**COMMIT this test** — `app/tests/moderation.test.js`: non-host `mod` rejected; banned player rejoining same code receives `error`; player leaving mid-game causes progress recomputed against remaining crewmates.

---

### T20: Second map & map registry
**STATUS: TODO**

One map is demo; replayability comes from knowing several maps well. This task makes map data plural without touching game logic.

**Requirements**

- Refactor `shared/map.ts` into `shared/maps/` with `MapDef` type and registry keyed by `mapId`. **No renames of existing exported fields** — rule 6 holds; `shared/map.ts` may re-export default map for compatibility. Type: `MapDef { id, name, walls: Segment[], rooms: RoomDef[], taskLocations: TaskLocation[], vents: Vent[], spawnPoints, emergencyButton, sabotagePoints, cameraPoints, sabotageKindsOffered }`.
- Ship **second, structurally different map** — smaller, more corridors, more vents — so difference is felt, not cosmetic. Eg `MIRA Mini` vs `Skeld`. Must have different room names, layout topology different (more linear vs central), more vent links (8 extra), different visual theme (slightly different wall colors per map, floor textures).
- Map is chosen in lobby settings and broadcast in `RoomView`; client renders whichever map server names, with **zero hard-coded geometry**. Client must fetch mapId from registry and render accordingly, including props per map.
- Every system that had map baked — movement, `roomAt`, vision, tasks, sabotage, surveillance, minimap — reads from registry via `getMap(mapId)`. No if(mapId===) in logic; all data-driven.
- Map thumbnails procedurally generated mini preview for browser.

**ADVANCED BAR:** Second map must be as detailed as first - not just 4 walls different. Should feel like a different spaceship with its own personality. First map Skeld-like (circular, central Cafeteria), second map Mira-like (vertical, narrow corridors, lab). Each has own prop set. Switching maps between rounds must fully re-seed tasks/spawns/camera with no geometry leftover (verify by clearing and rebuilding).

**Verify (do not commit)** — play full round on each map; confirm switching maps between rounds fully re-seeds task locations, spawns, camera positions with no geometry left over from previous map.

---

### T21: Deployment, docs & final acceptance
**STATUS: TODO**

Final task.

**Requirements**

- `npm start` serves production build on one port with correct caching headers (bundle.js immutable cache 1y, index.html no-cache); `PORT` and `HOST` configurable; graceful shutdown on SIGTERM closing ws.
- `app/README.md`: how to run locally, how to play, every setting explained, full protocol table, architecture paragraph, plus advanced features list, map list, roles list, screenshots description. Must look professional with Among Us style header.
- `GET /api/health` extends to `{status, uptime, rooms, players, version}` — **keep `status` and `rooms`** so T1's test still passes.
- `?bots=N` dev flag spawns simple bot players for solo testing. Bots walk (random walk + path toward task), complete tasks (auto taskStep after delay), vote randomly, can be impostor and kill? Simple AI: if impostor bot sees crewmate within kill radius and cooldown over and no witnesses, kill. Enough to exercise full round alone. Bot rendering uses same sprite but with BOT label.
- **Browser support check:** latest Chrome, Firefox, Safari, desktop+mobile, including iOS Safari (test touch controls and WebAudio unlocking on first gesture there specifically). Document support.
- Final pass: no console errors, no memory growth over 10-min game (check setInterval leaks), no unhandled promise rejections, and every earlier committed test still passing (`health`, `lobby`, `roles`, `vision`, `sabotage`, `surveillance`, `extendedroles`, `meeting`, `winconditions`, `resilience`, `browser`, `moderation`, `acceptance`).

**COMMIT this test** — `app/tests/acceptance.test.js`: health reports extended shape while still having `status === 'ok'`; full lobby→start→kill→meeting→eject→end sequence completes over WebSocket without error.

**ADVANCED BAR FOR FINAL:** README must have professional polish, include how to create custom maps, how roles work, and list advanced rendering techniques used. Bots must be usable and not jittery - they should use server-side movement with same collision. Production build must be minified but still work.

---

## Out of scope — deliberately not built

Listed so no agent "helpfully" adds them. Building any of these is a failed round.

- **Accounts, persistence, databases, stats or leaderboards.** Rooms are ephemeral and in-memory; that is a design decision, not an omission.
- **Voice chat / WebRTC.** Players use Discord. This adds a signalling server, TURN, permissions and a fifth dependency for no deduction value.
- **Matchmaking beyond T18's lobby browser** — no skill rating, no queues.
- **Monetisation, cosmetics unlocks, currency.** All cosmetics are free and available from the start.
- **Native or mobile app wrappers.** Browser only.
- **A map editor.** T20 makes maps data; authoring them is a code change.
- **Anti-cheat beyond server authority + T15 validation.** No obfuscation, no client attestation.
- **i18n.** English only; keep strings in one module so it stays possible.

---

## Advanced Definition of Done Checklist (Apply to EVERY Task)

Before marking your task DONE, confirm:

- [ ] Visual: Would a player confuse your UI with a dev debug panel? If yes, style it like Among Us (rounded corners, black stroke text, shadows).
- [ ] Animation: Every state change has tween/animation (no instant pop). Buttons have hover/press scale.
- [ ] Code: No `any`, no TODO, no console.log left, no 300-line function, constants.ts used.
- [ ] Server authoritative: Client intent only, server validates distance, LOS, cooldown, phase.
- [ ] No secret leak: Carefully review what you send in snapshot/joined.
- [ ] Polish: Shadows, gradients, particles or glow where appropriate.
- [ ] Tested: You ran with 2+ clients and drove the feature manually + typecheck + build.
- [ ] Feels like real Among Us, not a clone toy.

**If you skip this checklist, next agent will have to rewrite your basic code and you fail.**

---

## Activity Log

<!-- Agents append one line here per completed task -->
- T1 DONE — server skeleton (http+ws on one port), static hosting with traversal guard, `/api/health`, Among Us styled landing page with canvas starfield & spinning crewmate SVG, esbuild bundling, strict TS, `app/tests/health.test.js` committed and passing via `node fastcapture/smoke.js`.
