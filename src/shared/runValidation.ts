/**
 * Anti-cheat run validation, shared by the client (pre-flight + validating
 * downloaded ghosts) and both servers (authoritative check before a run is
 * written to the leaderboard).
 *
 * A run is accepted only if:
 *   • 0 < timeMs ≤ 60000 (integer),
 *   • ghost frames start at t=0, are strictly monotonic, sampled densely and
 *     end exactly at timeMs,
 *   • the trajectory starts inside the start box, never leaves the track tube,
 *     never exceeds the car's theoretical top speed between samples,
 *   • it crosses every checkpoint gate in order and then the finish line, with
 *     the finish crossing on the final sample.
 */
import { CAR, GHOST, MAX_TIME_MS } from '../game/config';
import { decodeGhost, type GhostFrames } from '../game/ghost/GhostCodec';
import { createProjection, gateCrossing, projectGlobal, projectLocal, signedGateDistance } from '../game/track/TrackQuery';
import type { Track } from '../game/track/TrackTypes';

export type ValidationResult = { ok: true; frames: GhostFrames } | { ok: false; reason: string };

/** Max sample spacing we accept (recorder samples every ~33ms). */
const MAX_SAMPLE_GAP_MS = 80;
/** How far beyond a wall a sample may sit (quantization). */
const WALL_SLACK = 3;
const GATE_EXTEND = 20;
/**
 * Speed model. The allowed speed follows a physics envelope: BOOST_MAX_SPEED
 * while a boost is active, decaying back toward MAX_SPEED afterwards. Limits
 * were calibrated on 1,500 autopilot + noisy-input laps over 150 circuits:
 * legit laps peak at 1.29× the envelope on isolated samples (moving hazards
 * can bat the car) and exceed it by 3% on at most ~10% of samples, while a lap sped up by 7%
 * exceeds it on 19%+ of samples.
 */
const ENVELOPE_DECAY_PER_S = 1.4;
const QUANT_SLACK_UNITS = 0.3;
const HARD_RATIO = 1.5;
const SOFT_RATIO = 1.03;
const SOFT_MAX_FRACTION = 0.14;
const SOFT_MIN_ALLOWED = 10;
const MAX_MEAN_SPEED = CAR.MAX_SPEED * 1.045;
/** A boost flag is only legitimate this long after touching a pad. */
const BOOST_WINDOW_MS = CAR.BOOST_MS + 120;

const fail = (reason: string): ValidationResult => ({ ok: false, reason });

export function validateRun(track: Track, timeMs: unknown, ghostData: unknown): ValidationResult {
  if (typeof timeMs !== 'number' || !Number.isInteger(timeMs)) return fail('time must be an integer');
  if (timeMs <= 0 || timeMs > MAX_TIME_MS) return fail('time out of range');
  const frames = decodeGhost(ghostData);
  if (!frames) return fail('ghost data malformed');
  return validateFrames(track, timeMs, frames);
}

export function validateFrames(track: Track, timeMs: number, f: GhostFrames): ValidationResult {
  const n = f.count;
  if (n < 2) return fail('ghost too short');
  if ((f.t[0] as number) !== 0) return fail('ghost must start at t=0');
  if ((f.t[n - 1] as number) !== timeMs) return fail('ghost must end at the run time');
  const minFrames = Math.floor(timeMs / MAX_SAMPLE_GAP_MS);
  if (n < minFrames) return fail('ghost too sparse');

  const X = (i: number): number => (f.x[i] as number) / GHOST.POS_SCALE;
  const Y = (i: number): number => (f.y[i] as number) / GHOST.POS_SCALE;

  // Start box.
  const sp = track.spawn;
  const ca = Math.cos(sp.angle);
  const sa = Math.sin(sp.angle);
  const dx0 = X(0) - sp.x;
  const dy0 = Y(0) - sp.y;
  const along0 = dx0 * ca + dy0 * sa;
  const lat0 = -dx0 * sa + dy0 * ca;
  if (Math.abs(along0) > track.startBox.along || Math.abs(lat0) > track.startBox.lateral) {
    return fail('ghost does not start on the grid');
  }

  const proj = createProjection();
  projectGlobal(track, X(0), Y(0), proj);
  let hint = proj.seg;
  let nextCp = 0;
  const cps = track.checkpoints;
  let finishedAt = -1;
  let envelope: number = CAR.MAX_SPEED;
  let softViolations = 0;
  let pathLength = 0;
  let lastPadMs = Number.NEGATIVE_INFINITY;
  if (onBoostPad(track, X(0), Y(0))) lastPadMs = 0;

  for (let i = 1; i < n; i++) {
    const t0 = f.t[i - 1] as number;
    const t1 = f.t[i] as number;
    const dt = t1 - t0;
    if (dt <= 0) return fail('ghost timestamps not strictly increasing');
    if (dt > MAX_SAMPLE_GAP_MS) return fail('ghost sample gap too large');
    const x0 = X(i - 1);
    const y0 = Y(i - 1);
    const x1 = X(i);
    const y1 = Y(i);
    const dist = Math.hypot(x1 - x0, y1 - y0);
    pathLength += dist;

    if (onBoostPad(track, x1, y1) || onBoostPad(track, (x0 + x1) / 2, (y0 + y1) / 2)) lastPadMs = t1;
    const boosting = (f.b[i] as number) === 1 || (f.b[i - 1] as number) === 1;
    if ((f.b[i] as number) === 1 && t1 - lastPadMs > BOOST_WINDOW_MS) return fail('boost without a boost pad');
    if (boosting) envelope = CAR.BOOST_MAX_SPEED;
    else envelope = CAR.MAX_SPEED + (envelope - CAR.MAX_SPEED) * Math.exp((-ENVELOPE_DECAY_PER_S * dt) / 1000);
    const ratio = (dist - QUANT_SLACK_UNITS) / ((envelope * dt) / 1000);
    if (ratio > HARD_RATIO) return fail('ghost exceeds maximum vehicle speed');
    if (ratio > SOFT_RATIO) softViolations++;

    projectLocal(track, x1, y1, hint, proj);
    hint = proj.seg;
    if (proj.dist > proj.hw - CAR.RADIUS + WALL_SLACK) return fail('ghost leaves the track');

    if (finishedAt >= 0) return fail('ghost continues after the finish line');
    if (nextCp < cps.length) {
      const gate = cps[nextCp];
      if (gate && gateCrossing(gate, x0, y0, x1, y1, GATE_EXTEND) >= 0) nextCp++;
    } else if (gateCrossing(track.startLine, x0, y0, x1, y1, GATE_EXTEND) >= 0) {
      finishedAt = i;
    }
  }

  if (softViolations > Math.max(SOFT_MIN_ALLOWED, n * SOFT_MAX_FRACTION)) return fail('ghost is faster than the car can drive');
  if (pathLength / (timeMs / 1000) > MAX_MEAN_SPEED) return fail('average speed is impossible');
  if (nextCp < cps.length) return fail('ghost skipped a checkpoint');
  if (finishedAt < 0) {
    // The finish frame sits exactly on the line; quantization can leave it a hair short.
    const last = n - 1;
    const d = signedGateDistance(track.startLine, X(last), Y(last));
    if (d < -1.5) return fail('ghost never crosses the finish line');
    finishedAt = last;
  }
  if (finishedAt !== n - 1) return fail('finish must be the final sample');
  return { ok: true, frames: f };
}

/** True if (x, y) is on (or right next to) any boost pad. */
function onBoostPad(track: Track, x: number, y: number): boolean {
  for (const pad of track.boostPads) {
    const dx = x - pad.cx;
    const dy = y - pad.cy;
    if (dx * dx + dy * dy > 160 * 160) continue;
    const along = dx * pad.tx + dy * pad.ty;
    const lat = dx * pad.nx + dy * pad.ny;
    if (Math.abs(along) <= pad.halfLength + 30 && Math.abs(lat) <= pad.halfWidth + CAR.RADIUS + 10) return true;
  }
  return false;
}
