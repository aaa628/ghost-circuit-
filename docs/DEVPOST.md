# Devpost submission — Ghost Circuit

> Paste-ready text for the Devpost form. Replace the bracketed links before submitting.

**Tagline:** A daily 60-second micro-racing time trial — race the ghosts of real Redditors.

**App listing:** [https://developers.reddit.com/apps/ghost-circuit]
**Demo post (public test subreddit, <200 members):** [https://www.reddit.com/r/YOUR_TEST_SUB/comments/...]
**Video (<1 min):** [YouTube link]
**Repo:** [GitHub link]
**Category:** Best Daily Game

## Inspiration
Daily puzzles are great, but they're solitary. We wanted the "one shared challenge per day" ritual
with the adrenaline of a racing game — and we wanted every Redditor's attempt to *show up* in
everyone else's game. Racing games already have the perfect mechanic for that: ghosts.

## What it does
Every day at 00:00 UTC a new miniature circuit unlocks and is posted to the subreddit
automatically. Two permanent circuits (Glitch Ridge and Static Vault) add all-time leaderboards
that never reset. Everyone gets the identical track — same corners, boost pads and hazards. You have
60 seconds to clear the checkpoints in order and cross the line. You race translucent ghosts of
real players: your personal best, today's #1, yesterday's champion, or anyone who challenged you.
A live split under the timer tells you, to the millisecond, whether you're ahead or behind.
Finish, and your lap is validated and ranked; hit Share & Challenge and your ghost becomes a
head-to-head race that lives in the comment thread.

## How we built it
- **Devvit Web**: inline splash (no game engine, fast in the feed) + expanded Phaser 3 game, an
  Express server on Devvit Redis, the scheduler for daily posts, Reddit share sheet with attached
  challenge data, comment-as-user for challenges.
- **Deterministic daily content**: a Mulberry32 seed from the UTC date drives one of five circuit
  archetypes (Grand Prix, Hairpin Valley, Technical, Speedway, Serpent) and seven feature types
  (split lanes, tunnels, rotating sweepers, sliding gates, chicane fins, pulsing domes, boost
  pads). Geometry is validated (corner radius, no self-overlap, always-passable hazards).
- **Fixed 60 Hz simulation** shared by the renderer, an autopilot, the tests and the anti-cheat
  validator. Hazards are pure functions of race time, so ghosts and players see them identically.
- **Ghosts**: 30 Hz quantized telemetry, delta + varint encoded (~5 KB per lap), interpolated with
  shortest-angle rotation.
- **Anti-cheat**: server-side trajectory validation — start box, ordered checkpoints, on-track,
  boost-aware speed envelope — calibrated on 1,500 laps.
- **Zero assets**: procedural sprites, particles and Web Audio synth sound.

## Challenges we ran into
Guaranteeing that a *random* track is always fair and finishable. We solved it by constructing
hazards with a guaranteed passage, validating geometry, and making an autopilot drive every
generated circuit in CI (365 days of tracks, 90 days of autopilot laps in tests). Calibrating
anti-cheat so no honest lap is ever rejected while sped-up ghosts are.

## Accomplishments we're proud of
- Instant retry in under a frame, with no scene reload.
- The same autopilot that validates tracks also produces the PACE BOT and offline rivals, so the
  game is fun even on a brand-new subreddit with zero players.
- Ghosts make the game social: you're always racing someone real.

## What we learned
Determinism is a feature: once every system is a pure function of the date and the race clock,
sharing, replays, validation and testing all fall out of it.

## What's next
Weekly cups (7-circuit aggregate), community-voted circuit modifiers, flair for daily champions,
and user-designed circuits (the generator already accepts any seed).

## Judging criteria
- **Delightful UX**: one-input start, instant retry, millisecond splits, a flat black/burgundy/white look that reads instantly,
  touch controls, synth audio.
- **Polish**: validated tracks, smooth fixed-timestep physics, offline fallback, no external assets.
- **Reddit-like & community-minded**: ghosts of real players, daily board, yesterday's champ,
  challenges in comments via share links and codes.
- **Fresh recurring content**: a brand-new circuit every day, auto-posted by the scheduler.
