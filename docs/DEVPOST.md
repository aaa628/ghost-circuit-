# Devpost submission: Ghost Circuit

Paste-ready text for each part of the Devpost form, in the order the form asks for it.

---

## 1. Project overview

**Project name** (60 max)

```
Ghost Circuit
```

**Elevator pitch** (200 max, this one is 148)

```
A daily 60-second racing time trial on Reddit. Everyone gets the same new track each day, and you race the ghosts of real Redditors for the #1 spot.
```

---

## 2. Project details

### About the project (paste everything inside the box)

```markdown
## Inspiration
Daily puzzles are great, but they're solitary. I wanted the "one shared challenge per day" ritual with the adrenaline of a racing game, and I wanted every Redditor's attempt to show up inside everyone else's game. Racing games already have the perfect mechanic for that: ghosts.

## What it does
Every day at 00:00 UTC a new miniature circuit unlocks and the app posts it to the subreddit by itself. Everyone gets the identical track: same corners, boost pads and hazards. You have 60 seconds to clear the checkpoints in order and cross the line.

- **Race real people.** Translucent ghosts of real players share the track with you: today's #1, yesterday's champion, or anyone who challenged you. Your own personal best rides along when there's no rival to chase.
- **Know where you stand.** A live split under the timer tells you, to the millisecond, whether you're ahead or behind, and every checkpoint names the ghost you're measured against.
- **Challenge friends.** Share & Challenge turns your lap into a head-to-head race: post it as a comment, share it, or send a GC-XXXXXXXX code that anyone can type into the game.
- **Daily and permanent.** Each circuit is clearly labelled. The DAILY track and its board last one day; three PERMANENT circuits keep all-time records forever: GLITCH RIDGE (hairpins), STATIC VAULT (fast sweepers) and SIDEWAYS (a pure drift course with no hazards and no boosts).
- **Feel the car.** A pre-rendered 3D-style car, skid marks, tyre smoke, impact sparks and synth audio, in a flat black, burgundy and white look.
- **Never an empty game.** On a brand-new circuit a PACE BOT, driven by the same autopilot that tests every track, gives you something to beat from the first second.

## How I built it
- **Devvit Web**: a lightweight splash in the feed and an expanded Phaser 3 game, an Express server on Devvit Redis, the scheduler for daily posts, install/upgrade triggers, the Reddit share sheet, and comment-as-user for challenges.
- **Deterministic daily content**: a seed from the UTC date picks one of five circuit styles and places split lanes, tunnels, rotating sweepers, sliding gates, chicane fins, pulsing hazards and boost pads. Every generated track is checked for corner radius, self-overlap and an always-passable route.
- **A fixed 60 Hz simulation** shared by the renderer, the autopilot, the tests and the anti-cheat. Hazards are pure functions of race time, so ghosts and players see exactly the same world.
- **Ghosts**: 30 Hz telemetry, quantized and delta-encoded to about 5 KB per lap.
- **Server-side anti-cheat**: every lap is re-checked against the track: start box, checkpoints in order, staying on the road, and a boost-aware speed limit.
- **No external assets**: sprites, particles and sound are all generated in code.

## Challenges I ran into
- **Fair random tracks.** A random track has to be finishable and fair every single day. Hazards are built with a guaranteed gap, geometry is validated, and an autopilot drives every generated circuit in the test suite.
- **A physics bug that looked like cheating.** Playtesting found that weaving left and right turned sideways slip into free speed, about 40% over top speed with no boost. Honest players doing it were flagged as cheaters. I fixed the physics so speed is never created from nothing, and added a regression test.
- **Anti-cheat that never punishes real players.** It is calibrated on thousands of simulated laps, including messy, drift-heavy and boost-chaining ones: 0 of 948 honest laps are rejected, while ghosts sped up by 7% or more are always caught.
- **Flaky connections.** A slow first request used to leave a player on a device-only leaderboard. The game now retries, reconnects on its own, and uploads any best lap set while offline.

## Accomplishments I'm proud of
- Instant retry with no reload: you're back on the grid in under a frame.
- The same autopilot validates tracks, drives the PACE BOT and stress-tests the anti-cheat.
- The ghosts make it social: you are always racing someone real.

## What I learned
Determinism is a feature. Once every system is a pure function of the date and the race clock, sharing, replays, validation and testing all come for free.

## What's next
Weekly cups (a seven-circuit total), flair for daily champions, community-voted modifiers, and player-designed circuits (the generator already accepts any seed).
```

### Built with

```
devvit, reddit, typescript, phaser, vite, express, redis, node.js, web-audio-api, playwright
```

### "Try it out" links

```
https://www.reddit.com/r/GhostCircuitGame
https://developers.reddit.com/apps/ghost-circuit
https://github.com/aaa628/ghost-circuit-
```

### Video demo link

Optional (under 1 minute, public on YouTube or Vimeo). Script: [DEMO_VIDEO.md](DEMO_VIDEO.md).

### Image gallery

Screenshots of: the main menu (Daily / Permanent sections), a race with the #1 ghost alongside, the results screen with the leaderboard, and the Share & Challenge card.

---

## 3. Hackathon questions

| Field | Answer |
|---|---|
| App listing | https://developers.reddit.com/apps/ghost-circuit |
| Test subreddit (public, under 200 members) | https://www.reddit.com/r/GhostCircuitGame |
| Demo post | Use the newest daily post in r/GhostCircuitGame (each one opens the game with all four circuits) |
| Public repository | https://github.com/aaa628/ghost-circuit- |
| README | In the repository root: README.md |
| New or existing project | New: built from scratch during the submission period (November 2026) |

## Judging criteria, for reference
- **Delightful UX**: one-input start, instant retry, millisecond splits, clear Daily/Permanent labels, touch controls, synth audio.
- **Polish**: validated tracks, fixed-timestep physics, server-side anti-cheat, automatic reconnect, no external assets.
- **Reddity**: ghosts of real players, a shared daily board, yesterday's champ, challenges in the comments.
- **Daily content**: a brand-new circuit every day, posted automatically, plus three permanent all-time circuits.
