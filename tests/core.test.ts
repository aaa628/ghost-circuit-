import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SKILLS, runAutopilot } from '../src/game/ai/Autopilot';
import { CAR, MAX_TIME_MS, TRACK } from '../src/game/config';
import { decodeGhost, encodeGhost } from '../src/game/ghost/GhostCodec';
import { ColliderPool, collectColliders } from '../src/game/track/Obstacles';
import { generateTrack, archetypeFor } from '../src/game/track/TrackGenerator';
import { __internal } from '../src/game/track/TrackGenerator';
import { shiftDateKey, utcDateKey, isDateKey, msUntilNextUtcDay } from '../src/game/util/date';
import { hashString, mulberry32 } from '../src/game/util/prng';
import { validateFrames, validateRun } from '../src/shared/runValidation';
import { fromChallengeCode, toChallengeCode, formatTime, formatDelta } from '../src/shared/api';

const START = '2026-11-11';
const days = (count: number): string[] => Array.from({ length: count }, (_, i) => shiftDateKey(START, i));

describe('prng & dates', () => {
  it('mulberry32 is deterministic', () => {
    const a = mulberry32(hashString('2026-11-21'));
    const b = mulberry32(hashString('2026-11-21'));
    for (let i = 0; i < 100; i++) assert.equal(a(), b());
  });
  it('date helpers', () => {
    assert.equal(utcDateKey(Date.UTC(2026, 10, 21, 23, 59, 59)), '2026-11-21');
    assert.equal(shiftDateKey('2026-12-31', 1), '2027-01-01');
    assert.equal(shiftDateKey('2026-03-01', -1), '2026-02-28');
    assert.ok(isDateKey('2026-11-21'));
    assert.ok(!isDateKey('2026-02-30'));
    assert.ok(!isDateKey('nope'));
    assert.equal(msUntilNextUtcDay(Date.UTC(2026, 10, 21, 23, 0, 0)), 3_600_000);
  });
});

describe('track generator', () => {
  it('is deterministic per date and differs between dates', () => {
    const a = generateTrack('2026-11-21');
    const xs = Array.from(a.xs.slice(0, 50));
    const b = generateTrack('2026-11-22');
    assert.notDeepEqual(Array.from(b.xs.slice(0, 50)), xs);
    // Regenerate from scratch (bypass cache by generating many other days first).
    for (const d of days(12)) generateTrack(d);
    const again = generateTrack('2026-11-21');
    assert.deepEqual(Array.from(again.xs.slice(0, 50)), xs);
    assert.equal(again.name, a.name);
    assert.equal(again.obstacles.length, a.obstacles.length);
  });

  it('never repeats the archetype two days running', () => {
    const list = days(400).map(archetypeFor);
    for (let i = 1; i < list.length; i++) assert.notEqual(list[i], list[i - 1]);
  });

  it('produces valid geometry for a year of circuits', () => {
    for (const d of days(365)) {
      const t = generateTrack(d);
      assert.ok(t.length >= TRACK.MIN_LENGTH && t.length <= TRACK.MAX_LENGTH + 200, `${d} length ${t.length}`);
      assert.ok(t.checkpoints.length >= 4 && t.checkpoints.length <= 6, `${d} checkpoints`);
      // Ordered, well separated, never on the start line.
      let prev = 0;
      for (const g of t.checkpoints) {
        assert.ok(g.s - prev >= 600, `${d} checkpoint spacing`);
        prev = g.s;
      }
      assert.ok(t.length - prev >= 600, `${d} last checkpoint too close to finish`);
      // Every sample is drivable and the radius fits the width.
      const tight = __internal.tightSamples(t.curvature, t.hw);
      assert.equal(tight.length, 0, `${d} has over-tight corners`);
      assert.ok(__internal.clearanceOk(t.xs, t.ys, t.hw, t.step), `${d} overlaps itself`);
      for (let i = 0; i < t.n; i++) assert.ok((t.hw[i] as number) - CAR.RADIUS > 30, `${d} too narrow`);
      assert.ok(t.boostPads.length >= 1, `${d} has no boost pad`);
    }
  });

  it('obstacles are pure functions of the race clock', () => {
    const t = generateTrack('2026-11-25');
    const a = new ColliderPool();
    const b = new ColliderPool();
    for (const ms of [0, 1234.5, 16_666.67, 59_999]) {
      collectColliders(t.obstacles, ms, a);
      collectColliders(t.obstacles, ms, b);
      assert.equal(a.count, b.count);
      for (let i = 0; i < a.count; i++) assert.deepEqual(a.items[i], b.items[i]);
    }
  });

  it('hazards always leave a passage wider than the car', () => {
    for (const d of days(120)) {
      const t = generateTrack(d);
      for (const o of t.obstacles) {
        if (o.type === 'sweeper') {
          const hw = TRACK.HALF_WIDTH * TRACK.ARENA_MULT;
          assert.ok(hw - (o.arm + o.thickness) >= 2 * CAR.RADIUS + 8, `${d} sweeper gap`);
        } else if (o.type === 'gate') {
          assert.ok(2 * o.gapHalf >= 2 * CAR.RADIUS + 30, `${d} gate gap`);
        } else if (o.type === 'pulsar') {
          // Anchored dome: the open side is (2hw + anchorOffset) - rMax.
          assert.ok(o.rMax > o.rMin, `${d} pulsar radii`);
        }
      }
    }
  });
});

describe('autopilot + anti-cheat', () => {
  it('every circuit is completable well inside 60s and its ghost validates', () => {
    for (const d of days(90)) {
      const t = generateTrack(d);
      const r = runAutopilot(t, SKILLS.rookie);
      assert.ok(r.finished, `${d} rookie autopilot did not finish`);
      assert.ok(r.timeMs < 40_000, `${d} took ${r.timeMs}ms`);
      const v = validateRun(t, r.timeMs, r.ghostData);
      assert.ok(v.ok, `${d} ghost rejected: ${v.ok ? '' : v.reason}`);
    }
  });

  const track = generateTrack('2026-11-30');
  const run = runAutopilot(track, SKILLS.pro);

  it('ghost codec round-trips exactly', () => {
    const f = decodeGhost(run.ghostData);
    assert.ok(f);
    assert.equal(encodeGhost(f), run.ghostData);
    assert.equal(f.t[f.count - 1], run.timeMs);
    assert.equal(decodeGhost('!!!'), null);
    assert.equal(decodeGhost(run.ghostData.slice(0, -7)), null);
  });

  it('accepts the genuine run', () => {
    assert.ok(run.finished);
    assert.ok(validateRun(track, run.timeMs, run.ghostData).ok);
  });

  it('rejects a faked time', () => {
    assert.equal(validateRun(track, run.timeMs - 1500, run.ghostData).ok, false);
    assert.equal(validateRun(track, 0, run.ghostData).ok, false);
    assert.equal(validateRun(track, MAX_TIME_MS + 1, run.ghostData).ok, false);
    assert.equal(validateRun(track, 1234.5, run.ghostData).ok, false);
  });

  it('rejects a compressed (too fast) trajectory', () => {
    const f = decodeGhost(run.ghostData);
    assert.ok(f);
    for (let i = 0; i < f.count; i++) f.t[i] = Math.round((f.t[i] as number) * 0.8);
    const v = validateFrames(track, f.t[f.count - 1] as number, f);
    assert.equal(v.ok, false);
  });

  it('rejects a teleport', () => {
    const f = decodeGhost(run.ghostData);
    assert.ok(f);
    const k = Math.floor(f.count / 2);
    f.x[k] = (f.x[k] as number) + 4000;
    assert.equal(validateFrames(track, run.timeMs, f).ok, false);
  });

  it('rejects skipping a checkpoint (cutting the track)', () => {
    const f = decodeGhost(run.ghostData);
    assert.ok(f);
    // Drop a big chunk of frames in the middle: either too sparse / too fast / off track / CP skipped.
    const a = Math.floor(f.count * 0.3);
    const b = Math.floor(f.count * 0.6);
    const keep = (arr: Int32Array | Int16Array | Uint8Array) => {
      const out = arr.slice(0, f.count - (b - a));
      out.set(arr.subarray(b, f.count), a);
      return out;
    };
    const cut = { count: f.count - (b - a), t: keep(f.t) as Int32Array, x: keep(f.x) as Int32Array, y: keep(f.y) as Int32Array, r: keep(f.r) as Int16Array, b: keep(f.b) as Uint8Array };
    assert.equal(validateFrames(track, cut.t[cut.count - 1] as number, cut).ok, false);
  });

  it('rejects a ghost that does not start on the grid', () => {
    const f = decodeGhost(run.ghostData);
    assert.ok(f);
    for (let i = 0; i < f.count; i++) f.x[i] = (f.x[i] as number) + 2000;
    assert.equal(validateFrames(track, run.timeMs, f).ok, false);
  });
});

describe('shared helpers', () => {
  it('challenge codes and formatting', () => {
    assert.equal(fromChallengeCode(toChallengeCode('abc23xyz')), 'abc23xyz');
    assert.equal(fromChallengeCode('gc-ABC23XYZ'), 'abc23xyz');
    assert.equal(fromChallengeCode('bad code!'), null);
    assert.equal(formatTime(24812), '24.812');
    assert.equal(formatTime(5007), '05.007');
    assert.equal(formatDelta(-312), '-0.312');
    assert.equal(formatDelta(1145), '+1.145');
  });
});
