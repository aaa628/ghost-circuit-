# 🏁 Ghost Circuit

**A daily 60-second micro-racing time trial for Reddit — race the ghosts of real players.**

Every day at 00:00 UTC a brand-new miniature circuit unlocks. Every Redditor on Earth gets the
*exact same* track: same hairpins, same boost pads, same sweeping hazards. You have
60.000 seconds to clear every checkpoint and cross the line. Your fastest lap becomes a
translucent **ghost** that everyone else races against — and you can challenge anyone in the
comments to beat yours, head-to-head.

Visual identity: flat black, burgundy (#6D001A) and white, with racing curbs, pre-lit 3D cars and
no glow, and a minimal main menu.

**Four circuits:**

| Circuit | Board | Notes |
|---|---|---|
| **Daily** | today only | a brand-new generated circuit every day at 00:00 UTC |
| **GLITCH RIDGE** | all-time | permanent hairpin course, never resets |
| **STATIC VAULT** | all-time | permanent high-speed course, never resets |
| **SIDEWAYS** | all-time | pure drift course: a ribbon of S-bends, no hazards, no boosts |

Each circuit has its own leaderboard, ghosts (PB, #1, rivals) and challenge links.

Built for **Reddit's Game of the Day Hackathon 2026** on **Devvit Web** (Phaser 3 + TypeScript + Vite,
Express server on Devvit Redis).

---

## How to play

| | Desktop | Phone |
|---|---|---|
| Accelerate | **▲ / W** | **GAS** |
| Brake / reverse | **▼ / S** | **BRAKE** |
| Steer | **◀ ▶ / A D** | **◀ ▶** |
| Drift (tight turns) | **Space** (or Shift) | **DRIFT** |
| Instant restart | **R** | **⟲** |

0. **Pick a circuit** in the main menu (☰ in the HUD brings it back).
1. **Go.** The clock starts on your first input (or a 3-2-1-GO countdown — toggle in ⚙).
2. **Hit the checkpoints in order** (`CP 2/5`), then cross the checkered finish line — all within **60.000s**.
   Run out of time and it's a **DNF**; press **R** and you're back on the grid in a blink.
3. **Read the hazards.** Red obstacles move to the *race clock*, not the wall clock — the same
   sweeper is in the same place at 7.250s for every player and every ghost. Learn their rhythm.
4. **Pick your line.** Burgundy **boost pads** with white chevrons launch you. **Split lanes**: the inner lane is shorter
   but squeezed by a pulsing dome; the outer lane is longer but has a boost. **Tunnels** are
   narrow. **Chicane fins** force a weave. Drift through hairpins.
5. **Race the ghosts** (toggle each in the top-right):
   - **PB** (white) — your personal best
   - **#1** (burgundy) — today's record holder (a *PACE BOT* until someone sets a time)
   - **CHAMP** (grey) — yesterday's #1, via **Challenge Yesterday's Champ**
   - **RIVAL** (pink) — any player you challenge from the leaderboard or a shared link
   The live split under the clock shows `-0.312` (ahead, white) / `+0.145` (behind, pink).
6. **Share & Challenge.** After a run, share it: on Reddit the share link opens the game with
   your ghost locked on the grid; you can also post it as a comment with a challenge code
   (`GC-XXXXXXXX`) anyone can type into the leaderboard panel.

---

## Why it's a good *Reddit* daily game

- **Fresh recurring content:** a deterministic generator (5 circuit archetypes × seeded layouts ×
  7 feature types) produces a genuinely different circuit every day, posted automatically at
  00:00 UTC by the Devvit scheduler. Never the same archetype two days in a row.
- **Community-minded:** you never race alone — ghosts are *real players'* laps. Daily leaderboard,
  yesterday's champion as a boss fight, head-to-head challenges that live in the comment thread.
- **Bite-sized & replayable:** 15–30 second laps, sub-100ms instant retry, millisecond splits.
- **Fair:** every ghost is validated server-side (see *Anti-cheat*) before it hits the board.

---

## Architecture

```
            ┌──────────── Reddit post (Devvit Web) ─────────────┐
 feed  ───▶ │ splash.html  (inline, no Phaser, ~70 KB)           │
            │   today's circuit preview + #1 ghost lap, stats,   │
            │   challenge card, RACE ──▶ requestExpandedMode     │
            │ game.html    (expanded)                            │
            │   Phaser 3 RaceScene ◀─▶ GameApp ◀─▶ DOM UI         │
            │        │ fixed 60 Hz RaceSim (pure TS)             │
            │        ▼                                           │
            │   LeaderboardService ── fetch /api/* ──┐           │
            └────────────────────────────────────────┼───────────┘
                                                     ▼
            Devvit server (src/server/index.ts → dist/server/index.cjs)
              Express ── server/app.ts (REST + anti-cheat) ── RunStore ── Devvit Redis
              scheduler 00:00 UTC → daily post · menu "post today's track" · onAppInstall

            Standalone mode (npm run dev): same server/app.ts on Express :8787 with an
            in-memory Redis (MemoryRedis, persisted to .data/), Vite client on :5173.
            No server at all? The client falls back to a localStorage leaderboard
            pre-seeded with autopilot ghosts — it always runs out of the box.
```

### Key design decisions

- **Determinism first.** `TrackGenerator` seeds Mulberry32 with the UTC date key. Physics runs on a
  fixed `FIXED_DT = 1000/60 ms` accumulator, decoupled from 60/120/144 Hz displays, with render
  interpolation. Every dynamic obstacle is a pure function of `elapsedMs`.
- **One simulation everywhere.** `RaceSim` (car + obstacles + ordered checkpoints + 60s clock +
  ghost recording) is plain TypeScript. The Phaser scene, the autopilot, the tests and the
  validator all use it — what you see is exactly what gets validated.
- **Compact ghosts.** Sampled every 2 ticks (30 Hz): `{t, x, y, r, b}` quantized to 1 ms /
  0.1 units / 0.01 rad, delta + zig-zag varint encoded, base64url. A 20s lap ≈ 5 KB.
- **Guaranteed-valid circuits.** Centripetal Catmull-Rom loops, curvature relaxation so every
  corner radius ≥ 1.7× the local half-width, a spatial-hash clearance check so no two parts of
  the track overlap, hazards constructed so they *always* leave a passage wider than the car,
  and an autopilot that must finish every circuit (tests cover 365 days of tracks and 90 days of laps;
  the dev sweep covers 200 days × 4 skill levels).
- **Autopilot = free content.** The same bot that proves tracks are drivable generates the
  *PACE BOT* ghost for empty boards and the offline-mode seeded rivals — genuine physics laps
  that pass validation. `?autopilot=1` lets it drive your car (great for demo footage).
- **Zero assets.** Car sprites, particles and UI icons are generated with Canvas/Graphics;
  every sound (engine, boost whoosh, checkpoint chime, wall thud, fanfares) is synthesized
  with the Web Audio API. Nothing can 404.
- **Lifecycle hygiene.** Instant retry resets the sim, ghosts, hazards, particles and camera in
  place (no scene reload). Every keyboard/pointer/resize/visibility listener is registered with a
  disposer and removed on teardown.

### Anti-cheat (`src/shared/runValidation.ts`, run on client *and* server)

A run is accepted only if: `0 < timeMs ≤ 60000` (integer); frame timestamps start at 0, are
strictly increasing, densely sampled and end exactly at `timeMs`; the trajectory starts in the
start box, never leaves the track tube, hits every checkpoint **in order** and finishes on the
final sample; it never exceeds the car's physically possible speed (a boost-aware envelope:
boost is only legal right after touching a real pad), and the lap's average speed is plausible.
The speed limits were calibrated on 1,500 laps (autopilot + noisy inputs): 0 legit laps rejected,
every lap sped up by ≥7% rejected. Usernames come from Reddit's server context, never the client.

---

## Project structure

```
devvit.json                 Devvit app config (entrypoints, scheduler, menu, triggers)
splash.html / game.html     Web-view entrypoints
vite.config.ts              Devvit build  (dist/client + dist/server/index.cjs)
vite.local.config.ts        Standalone build/dev server
src/
  main.ts                   game.html entry
  app/GameApp.ts            modes, ghost roster, submissions, sharing, UI wiring
  game/
    config.ts               Phaser config + all tuning constants (FIXED_DT, speeds, MAX_TIME_MS…)
    track/TrackGenerator.ts deterministic daily circuit + features + checkpoints
    track/Circuits.ts       circuit registry: daily keys + the two all-time circuits
    track/Obstacles.ts      race-clock-synced hazard colliders (pure functions of elapsedMs)
    track/TrackQuery.ts     projections, gate crossings, progress
    physics/CarController.ts fixed-timestep arcade physics, drift, boost, wall sliding
    race/RaceSim.ts         headless race: physics + checkpoints + 60s clock + recording
    ghost/GhostRecorder.ts  30 Hz telemetry capture + quantization
    ghost/GhostCodec.ts     binary ghost format
    ghost/GhostTimeline.ts  interpolation (lerp + shortest-angle) + split-delta curve
    ghost/GhostPlayer.ts    ghost rendering: translucent car, trail, floating tag
    ai/Autopilot.ts         deterministic driver (track validation, pace & seed ghosts)
    audio/SynthAudio.ts     procedural Web Audio
    input/InputController.ts keyboard + touch merge
    render/CarModel.ts      low-poly car pre-rendered to a 72-angle lit sprite sheet
    render/*                track, hazards, procedural textures
    scenes/RaceScene.ts     Phaser scene: accumulator, camera, particles, ghosts
  services/
    LeaderboardService.ts   API client, localStorage fallback (seeded), validator,
                            challenge links, Yesterday's Champion loader, PB cache
    platform.ts             Reddit (Devvit) vs browser bridge
  shared/                   wire types + anti-cheat validator
  ui/MainMenu.ts            minimal main menu (circuits, boards, help)
  ui/                       HUD, minimap, touch controls, post-run, leaderboard,
                            share, settings, toasts (DOM; user text via textContent only)
  splash/                   feed splash + canvas track preview
  server/                   Devvit server entry + daily post creation
server/
  app.ts                    Express REST API (shared by both servers)
  RunStore.ts               leaderboard/ghost storage over a Redis interface
  MemoryRedis.ts            in-memory Redis for standalone mode
  local.ts                  standalone server entry
tests/                      node:test suites (generator, physics, anti-cheat, API)
scripts/dev.mjs             runs client + server together
scripts/smoke-e2e.cjs       optional Playwright smoke test
```

### REST API

| Method | Path | |
|---|---|---|
| GET | `/api/init` | platform, username, today, post date, today's post id |
| GET | `/api/leaderboard/:circuit` | top N (default 10) + your pinned standing and gap to next |
| GET | `/api/champion/:circuit` | that circuit's #1 run with ghost |
| GET | `/api/run/:runId` | a run with ghost (challenges) |
| POST | `/api/runs` | `{dateKey, timeMs, ghostData, share?}` → validated, ranked |

`:circuit` / `dateKey` is a circuit key: a UTC date (`2026-11-21`) for the daily circuit, or a
permanent id (`perm-ridge`, `perm-vault`, `perm-drift`) for the all-time boards (defined in
`src/game/track/Circuits.ts`). Daily boards accept runs only on their day; all-time boards always.
| POST | `/api/comment` | Reddit only: post a challenge comment as the user |

---

## Run it

Requires **Node 22.12+** (Node 24 recommended for the Devvit CLI).

```bash
npm install
npm run dev          # standalone: game on http://localhost:5173, API on :8787
npm test             # generator, physics, anti-cheat and API tests
npm run type-check
npm start            # production standalone build served from http://localhost:8787
```

Challenge links in standalone mode look like `http://localhost:5173/?date=2026-11-21&challenge=<runId>`
(or `?circuit=perm-ridge&challenge=<runId>` for the all-time circuits).

### On Reddit (Devvit)

```bash
npm run login        # devvit login (opens reddit.com)
npm run playtest     # builds and installs to your test subreddit with live reload
npm run deploy       # type-check + tests + devvit upload (private build)
```

Then, as a moderator of your test subreddit, use the subreddit menu
**"Ghost Circuit: post today's track"** (also posted automatically on install and every day at
00:00 UTC by the scheduler).

> **Determinism contract.** Circuits and ghosts depend on the generator and physics constants.
> Don't change `TrackGenerator.ts`, `config.ts` physics/track values or the PRNG after launch
> without bumping the storage prefix (currently `gc:v2:`) — otherwise stored ghosts no longer match their
> circuits (the client safely hides ghosts that fail validation).
