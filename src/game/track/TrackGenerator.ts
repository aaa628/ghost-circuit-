/**
 * Deterministic daily circuit generator.
 *
 *   dateKey "YYYY-MM-DD" ─► seed ─► Mulberry32 ─► archetype + control points
 *   ─► centripetal Catmull-Rom loop ─► uniform resample ─► geometric validation
 *   ─► start straight + direction ─► features (split lanes, tunnels, sweepers,
 *   sliding gates, chicanes, pulsars, boost pads) ─► checkpoints.
 *
 * Every player on Earth gets the identical circuit for the same UTC date.
 * Validation guarantees drivable width everywhere, no overlapping sections,
 * non-overlapping checkpoints, and a passage of at least TRACK.MIN_PASSAGE
 * through every hazard at every instant (verified for 1000+ days in tests by
 * an autopilot that must finish well inside 60s).
 */
import { CAR, TRACK } from '../config';
import { circuitNumber, dayIndex } from '../util/date';
import { TAU, clamp, smoothstep, wrapAngle } from '../util/math';
import { Rng, hashString } from '../util/prng';
import type {
  ArchetypeId,
  BoostPad,
  Gate,
  ObstacleDef,
  Track,
  Zone,
} from './TrackTypes';

type FeatureKind = 'split' | 'tunnel' | 'sweeper' | 'gate' | 'chicane' | 'pulsar' | 'boost';

type Archetype = {
  id: ArchetypeId;
  label: string;
  nouns: readonly string[];
  points: readonly [number, number];
  radial: readonly [number, number];
  hairpins: readonly [number, number];
  rx: number;
  ry: number;
  /** Radial wiggle amplitude and frequency (serpent-style bends). */
  wiggle: number;
  wiggleFreq: number;
  /** Probability (0..1) or count ranges per feature. */
  plan: Record<FeatureKind, readonly [number, number]>;
};

const ARCHETYPES: readonly Archetype[] = [
  {
    id: 'grandprix',
    label: 'Grand Prix',
    nouns: ['RING', 'GRAND PRIX', 'CIRCUIT', 'LOOP'],
    points: [9, 11],
    radial: [0.66, 1.0],
    hairpins: [0, 1],
    rx: 1800,
    ry: 1200,
    wiggle: 0,
    wiggleFreq: 0,
    plan: { split: [0, 1], tunnel: [0, 1], sweeper: [1, 2], gate: [0, 1], chicane: [0, 1], pulsar: [1, 2], boost: [2, 3] },
  },
  {
    id: 'hairpin',
    label: 'Hairpin Valley',
    nouns: ['SWITCHBACK', 'HAIRPINS', 'ZIGZAG', 'VALLEY'],
    points: [8, 10],
    radial: [0.74, 1.0],
    hairpins: [2, 3],
    rx: 1920,
    ry: 1272,
    wiggle: 0,
    wiggleFreq: 0,
    plan: { split: [0, 1], tunnel: [0, 1], sweeper: [1, 1], gate: [0, 1], chicane: [0, 1], pulsar: [1, 2], boost: [2, 3] },
  },
  {
    id: 'technical',
    label: 'Technical',
    nouns: ['LABYRINTH', 'GAUNTLET', 'KNOT', 'MAZE'],
    points: [11, 14],
    radial: [0.5, 1.0],
    hairpins: [1, 2],
    rx: 1860,
    ry: 1296,
    wiggle: 0,
    wiggleFreq: 0,
    plan: { split: [0, 1], tunnel: [0, 1], sweeper: [1, 2], gate: [1, 1], chicane: [1, 1], pulsar: [1, 2], boost: [1, 2] },
  },
  {
    id: 'speedway',
    label: 'Speedway',
    nouns: ['SPEEDWAY', 'OVAL', 'RACEWAY', 'VELODROME'],
    points: [6, 8],
    radial: [0.8, 1.0],
    hairpins: [0, 1],
    rx: 2100,
    ry: 1260,
    wiggle: 0,
    wiggleFreq: 0,
    plan: { split: [1, 1], tunnel: [0, 1], sweeper: [1, 1], gate: [0, 1], chicane: [0, 1], pulsar: [1, 1], boost: [3, 4] },
  },
  {
    id: 'serpent',
    label: 'Serpent',
    nouns: ['SERPENT', 'VIPER', 'COIL', 'RIBBON'],
    points: [12, 15],
    radial: [0.82, 1.0],
    hairpins: [0, 1],
    rx: 2220,
    ry: 1080,
    wiggle: 0.17,
    wiggleFreq: 4,
    plan: { split: [0, 1], tunnel: [1, 1], sweeper: [1, 1], gate: [0, 1], chicane: [0, 1], pulsar: [1, 2], boost: [2, 3] },
  },
];

const ADJECTIVES = [
  'IRON', 'CHROME', 'ULTRAVIOLET', 'COBALT', 'VOLTAGE', 'MIDNIGHT', 'PLASMA', 'STATIC',
  'LASER', 'PHANTOM', 'HYPER', 'QUANTUM', 'AFTERGLOW', 'CYBER', 'VELVET', 'SOLAR',
  'SPECTRAL', 'ION', 'NOVA', 'OBSIDIAN',
];

const MAX_ATTEMPTS = 48;

// ─── Polyline helpers ───────────────────────────────────────────────────────

type Loop = { xs: Float64Array; ys: Float64Array };

function centripetalCatmullRom(px: number[], py: number[], samplesPerSpan: number): Loop {
  const k = px.length;
  const total = k * samplesPerSpan;
  const xs = new Float64Array(total);
  const ys = new Float64Array(total);
  const knot = (ax: number, ay: number, bx: number, by: number): number => {
    const d = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    return Math.max(1e-4, Math.sqrt(d));
  };
  let o = 0;
  for (let i = 0; i < k; i++) {
    const i0 = (i - 1 + k) % k;
    const i2 = (i + 1) % k;
    const i3 = (i + 2) % k;
    const p0x = px[i0] as number;
    const p0y = py[i0] as number;
    const p1x = px[i] as number;
    const p1y = py[i] as number;
    const p2x = px[i2] as number;
    const p2y = py[i2] as number;
    const p3x = px[i3] as number;
    const p3y = py[i3] as number;
    const t0 = 0;
    const t1 = t0 + knot(p0x, p0y, p1x, p1y);
    const t2 = t1 + knot(p1x, p1y, p2x, p2y);
    const t3 = t2 + knot(p2x, p2y, p3x, p3y);
    for (let j = 0; j < samplesPerSpan; j++) {
      const t = t1 + ((t2 - t1) * j) / samplesPerSpan;
      const a1x = ((t1 - t) / (t1 - t0)) * p0x + ((t - t0) / (t1 - t0)) * p1x;
      const a1y = ((t1 - t) / (t1 - t0)) * p0y + ((t - t0) / (t1 - t0)) * p1y;
      const a2x = ((t2 - t) / (t2 - t1)) * p1x + ((t - t1) / (t2 - t1)) * p2x;
      const a2y = ((t2 - t) / (t2 - t1)) * p1y + ((t - t1) / (t2 - t1)) * p2y;
      const a3x = ((t3 - t) / (t3 - t2)) * p2x + ((t - t2) / (t3 - t2)) * p3x;
      const a3y = ((t3 - t) / (t3 - t2)) * p2y + ((t - t2) / (t3 - t2)) * p3y;
      const b1x = ((t2 - t) / (t2 - t0)) * a1x + ((t - t0) / (t2 - t0)) * a2x;
      const b1y = ((t2 - t) / (t2 - t0)) * a1y + ((t - t0) / (t2 - t0)) * a2y;
      const b2x = ((t3 - t) / (t3 - t1)) * a2x + ((t - t1) / (t3 - t1)) * a3x;
      const b2y = ((t3 - t) / (t3 - t1)) * a2y + ((t - t1) / (t3 - t1)) * a3y;
      xs[o] = ((t2 - t) / (t2 - t1)) * b1x + ((t - t1) / (t2 - t1)) * b2x;
      ys[o] = ((t2 - t) / (t2 - t1)) * b1y + ((t - t1) / (t2 - t1)) * b2y;
      o++;
    }
  }
  return { xs, ys };
}

function loopLength(loop: Loop): number {
  const n = loop.xs.length;
  let L = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = (loop.xs[j] as number) - (loop.xs[i] as number);
    const dy = (loop.ys[j] as number) - (loop.ys[i] as number);
    L += Math.sqrt(dx * dx + dy * dy);
  }
  return L;
}

/** Resample a closed polyline to (almost) exactly `step` spacing. */
function resampleClosed(loop: Loop, step: number): Loop {
  const n = loop.xs.length;
  const L = loopLength(loop);
  const count = Math.max(16, Math.round(L / step));
  const spacing = L / count;
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  let seg = 0;
  let segStart = 0;
  let ax = loop.xs[0] as number;
  let ay = loop.ys[0] as number;
  let bx = loop.xs[1 % n] as number;
  let by = loop.ys[1 % n] as number;
  let segLen = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
  for (let k = 0; k < count; k++) {
    const target = k * spacing;
    while (segStart + segLen < target && seg < n) {
      segStart += segLen;
      seg++;
      ax = loop.xs[seg % n] as number;
      ay = loop.ys[seg % n] as number;
      bx = loop.xs[(seg + 1) % n] as number;
      by = loop.ys[(seg + 1) % n] as number;
      segLen = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    }
    const u = segLen > 1e-9 ? clamp((target - segStart) / segLen, 0, 1) : 0;
    xs[k] = ax + (bx - ax) * u;
    ys[k] = ay + (by - ay) * u;
  }
  return { xs, ys };
}

function smoothLoop(loop: Loop, passes: number, lambda: number, mask?: Uint8Array): void {
  const n = loop.xs.length;
  const tx = new Float64Array(n);
  const ty = new Float64Array(n);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      const x = loop.xs[i] as number;
      const y = loop.ys[i] as number;
      if (mask && mask[i] === 0) {
        tx[i] = x;
        ty[i] = y;
        continue;
      }
      tx[i] = x + lambda * (((loop.xs[a] as number) + (loop.xs[b] as number)) * 0.5 - x);
      ty[i] = y + lambda * (((loop.ys[a] as number) + (loop.ys[b] as number)) * 0.5 - y);
    }
    loop.xs.set(tx);
    loop.ys.set(ty);
  }
}

function reverseLoop(loop: Loop): Loop {
  const n = loop.xs.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = loop.xs[(n - i) % n] as number;
    ys[i] = loop.ys[(n - i) % n] as number;
  }
  return { xs, ys };
}

function rotateLoop(loop: Loop, start: number): Loop {
  const n = loop.xs.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = loop.xs[(i + start) % n] as number;
    ys[i] = loop.ys[(i + start) % n] as number;
  }
  return { xs, ys };
}

/** Signed curvature per sample, lightly smoothed. */
function computeCurvature(loop: Loop): Float64Array {
  const n = loop.xs.length;
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n;
    const b = (i + 1) % n;
    const h0 = Math.atan2((loop.ys[i] as number) - (loop.ys[a] as number), (loop.xs[i] as number) - (loop.xs[a] as number));
    const h1 = Math.atan2((loop.ys[b] as number) - (loop.ys[i] as number), (loop.xs[b] as number) - (loop.xs[i] as number));
    const dxa = (loop.xs[i] as number) - (loop.xs[a] as number);
    const dya = (loop.ys[i] as number) - (loop.ys[a] as number);
    const dxb = (loop.xs[b] as number) - (loop.xs[i] as number);
    const dyb = (loop.ys[b] as number) - (loop.ys[i] as number);
    const ds = 0.5 * (Math.sqrt(dxa * dxa + dya * dya) + Math.sqrt(dxb * dxb + dyb * dyb));
    raw[i] = wrapAngle(h1 - h0) / Math.max(1e-6, ds);
  }
  const out = new Float64Array(n);
  const W = 2;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -W; k <= W; k++) sum += raw[(i + k + n) % n] as number;
    out[i] = sum / (2 * W + 1);
  }
  return out;
}

/** Samples whose radius is too tight for their half-width. */
function tightSamples(curv: Float64Array, hw: Float64Array): number[] {
  const bad: number[] = [];
  for (let i = 0; i < curv.length; i++) {
    const k = Math.abs(curv[i] as number);
    if (k * (hw[i] as number) * TRACK.MIN_RADIUS_MULT > 1) bad.push(i);
  }
  return bad;
}

/**
 * True when no two unrelated parts of the tube come closer than
 * hw_i + hw_j + WALL_GAP. Pairs whose arc distance is close to their straight
 * distance belong to the same stretch of road and are skipped.
 */
function clearanceOk(
  xs: Float64Array,
  ys: Float64Array,
  hw: Float64Array,
  step: number,
  subset?: readonly number[],
): boolean {
  const n = xs.length;
  const L = n * step;
  let maxHw = 0;
  for (let i = 0; i < n; i++) maxHw = Math.max(maxHw, hw[i] as number);
  const cell = 2 * maxHw + TRACK.WALL_GAP + 4;
  const grid = new Map<number, number[]>();
  const keyOf = (cx: number, cy: number): number => (cx + 2048) * 4096 + (cy + 2048);
  for (let i = 0; i < n; i++) {
    const cx = Math.floor((xs[i] as number) / cell);
    const cy = Math.floor((ys[i] as number) / cell);
    const key = keyOf(cx, cy);
    let bucket = grid.get(key);
    if (!bucket) {
      bucket = [];
      grid.set(key, bucket);
    }
    bucket.push(i);
  }
  const check = (i: number): boolean => {
    const x = xs[i] as number;
    const y = ys[i] as number;
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    for (let gx = -1; gx <= 1; gx++) {
      for (let gy = -1; gy <= 1; gy++) {
        const bucket = grid.get(keyOf(cx + gx, cy + gy));
        if (!bucket) continue;
        for (const j of bucket) {
          if (j === i) continue;
          const dx = (xs[j] as number) - x;
          const dy = (ys[j] as number) - y;
          const need = (hw[i] as number) + (hw[j] as number) + TRACK.WALL_GAP;
          const d2 = dx * dx + dy * dy;
          if (d2 >= need * need) continue;
          const di = Math.abs(i - j) * step;
          const arc = Math.min(di, L - di);
          const d = Math.sqrt(d2);
          if (arc > 1.3 * d + 20) return false;
        }
      }
    }
    return true;
  };
  if (subset) {
    for (const i of subset) if (!check(i)) return false;
    return true;
  }
  for (let i = 0; i < n; i++) if (!check(i)) return false;
  return true;
}

// ─── Control points ─────────────────────────────────────────────────────────

function buildControlPoints(arch: Archetype, rng: Rng): { px: number[]; py: number[] } {
  const k = rng.int(arch.points[0], arch.points[1]);
  const rx = arch.rx * rng.range(0.92, 1.08);
  const ry = arch.ry * rng.range(0.92, 1.08);
  const rot = rng.range(0, TAU);
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const hairpins = new Set<number>();
  const wanted = rng.int(arch.hairpins[0], arch.hairpins[1]);
  for (const idx of rng.shuffle(Array.from({ length: k }, (_, i) => i))) {
    if (hairpins.size >= wanted) break;
    if (hairpins.has((idx + 1) % k) || hairpins.has((idx - 1 + k) % k)) continue;
    hairpins.add(idx);
  }
  const wigglePhase = rng.range(0, TAU);
  const px: number[] = [];
  const py: number[] = [];
  for (let i = 0; i < k; i++) {
    const theta = ((i + rng.range(-0.2, 0.2)) / k) * TAU;
    let r = rng.range(arch.radial[0], arch.radial[1]);
    if (hairpins.has(i)) r *= rng.range(0.28, 0.42);
    if (arch.wiggle > 0) r *= 1 + arch.wiggle * Math.sin(theta * arch.wiggleFreq + wigglePhase);
    const x = Math.cos(theta) * rx * r;
    const y = Math.sin(theta) * ry * r;
    px.push(x * cr - y * sr);
    py.push(x * sr + y * cr);
  }
  return { px, py };
}

/** A smooth, always-valid superellipse used if every random attempt fails. */
function buildFallbackLoop(rng: Rng): Loop {
  const count = 720;
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  const rx = 1500;
  const ry = 900;
  const rot = rng.range(0, TAU);
  for (let i = 0; i < count; i++) {
    const t = (i / count) * TAU;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = Math.sign(c) * Math.pow(Math.abs(c), 0.62) * rx;
    const y = Math.sign(s) * Math.pow(Math.abs(s), 0.62) * ry;
    xs[i] = x * Math.cos(rot) - y * Math.sin(rot);
    ys[i] = x * Math.sin(rot) + y * Math.cos(rot);
  }
  const loop = { xs, ys };
  smoothLoop(loop, 20, 0.5);
  return resampleClosed(loop, TRACK.STEP);
}

/** Build and validate a base loop (constant width). Returns null on failure. */
function buildBaseLoop(arch: Archetype, rng: Rng): Loop | null {
  const { px, py } = buildControlPoints(arch, rng);
  let loop = resampleClosed(centripetalCatmullRom(px, py, 40), TRACK.STEP);
  smoothLoop(loop, 3, 0.5);
  loop = resampleClosed(loop, TRACK.STEP);
  // Iteratively relax only the over-tight spots so the character survives.
  for (let round = 0; round < 40; round++) {
    const n = loop.xs.length;
    const hw = new Float64Array(n).fill(TRACK.HALF_WIDTH);
    const bad = tightSamples(computeCurvature(loop), hw);
    if (bad.length === 0) break;
    const mask = new Uint8Array(n);
    for (const i of bad) {
      for (let k = -14; k <= 14; k++) mask[(i + k + n) % n] = 1;
    }
    smoothLoop(loop, 4, 0.5, mask);
    loop = resampleClosed(loop, TRACK.STEP);
  }
  return finishBase(loop, new Float64Array(loop.xs.length).fill(TRACK.HALF_WIDTH));
}

function finishBase(loop: Loop, hw: Float64Array): Loop | null {
  const curv = computeCurvature(loop);
  if (tightSamples(curv, hw).length > 0) return null;
  const L = loop.xs.length * TRACK.STEP;
  if (L < TRACK.MIN_LENGTH || L > TRACK.MAX_LENGTH) return null;
  if (!clearanceOk(loop.xs, loop.ys, hw, TRACK.STEP)) return null;
  return loop;
}

// ─── Track assembly ─────────────────────────────────────────────────────────

type Builder = {
  loop: Loop;
  n: number;
  step: number;
  length: number;
  tx: Float64Array;
  ty: Float64Array;
  nx: Float64Array;
  ny: Float64Array;
  curvature: Float64Array;
  hw: Float64Array;
  occupied: Array<[number, number]>;
  gatesS: number[];
  obstacles: ObstacleDef[];
  boostPads: BoostPad[];
  zones: Zone[];
  nextId: number;
};

function computeFrames(loop: Loop): Pick<Builder, 'tx' | 'ty' | 'nx' | 'ny'> {
  const n = loop.xs.length;
  const tx = new Float64Array(n);
  const ty = new Float64Array(n);
  const nx = new Float64Array(n);
  const ny = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n;
    const b = (i + 1) % n;
    let dx = (loop.xs[b] as number) - (loop.xs[a] as number);
    let dy = (loop.ys[b] as number) - (loop.ys[a] as number);
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= len;
    dy /= len;
    tx[i] = dx;
    ty[i] = dy;
    nx[i] = -dy;
    ny[i] = dx;
  }
  return { tx, ty, nx, ny };
}

const idx = (b: Builder, s: number): number => {
  let w = s % b.length;
  if (w < 0) w += b.length;
  return Math.round(w / b.step) % b.n;
};

function rangeIndices(b: Builder, s0: number, s1: number): number[] {
  const out: number[] = [];
  for (let s = s0; s <= s1; s += b.step) out.push(idx(b, s));
  return out;
}

function isFree(b: Builder, s0: number, s1: number, margin: number): boolean {
  if (s0 < TRACK.START_CLEAR_AFTER || s1 > b.length - TRACK.START_CLEAR_BEFORE) return false;
  for (const [a, c] of b.occupied) {
    if (s0 < c + margin && s1 > a - margin) return false;
  }
  return true;
}

function nearGate(b: Builder, s0: number, s1: number, margin: number): boolean {
  for (const g of b.gatesS) if (g > s0 - margin && g < s1 + margin) return true;
  return false;
}

function maxAbsCurv(b: Builder, s0: number, s1: number): number {
  let m = 0;
  for (const i of rangeIndices(b, s0, s1)) m = Math.max(m, Math.abs(b.curvature[i] as number));
  return m;
}

function meanCurv(b: Builder, s0: number, s1: number): number {
  const ids = rangeIndices(b, s0, s1);
  let sum = 0;
  for (const i of ids) sum += b.curvature[i] as number;
  return ids.length ? sum / ids.length : 0;
}

/** Find a random valid start position for a feature span. */
function findSpot(
  b: Builder,
  rng: Rng,
  len: number,
  maxCurv: number,
  opts: { avoidGates: boolean; margin: number },
): number | null {
  const candidates: number[] = [];
  for (let s0 = TRACK.START_CLEAR_AFTER; s0 + len <= b.length - TRACK.START_CLEAR_BEFORE; s0 += 40) {
    const s1 = s0 + len;
    if (!isFree(b, s0, s1, opts.margin)) continue;
    if (opts.avoidGates && nearGate(b, s0, s1, 70)) continue;
    if (maxAbsCurv(b, s0, s1) > maxCurv) continue;
    candidates.push(s0);
  }
  return candidates.length ? rng.pick(candidates) : null;
}

/** Apply a smooth width change over [s0, s1] with ramps; returns the previous values. */
function applyWidth(b: Builder, s0: number, s1: number, mult: number, ramp: number): Map<number, number> {
  const prev = new Map<number, number>();
  for (let s = s0; s <= s1; s += b.step) {
    const i = idx(b, s);
    const k = Math.min(smoothstep(s0, s0 + ramp, s), 1 - smoothstep(s1 - ramp, s1, s));
    if (!prev.has(i)) prev.set(i, b.hw[i] as number);
    b.hw[i] = TRACK.HALF_WIDTH * (1 + (mult - 1) * k);
  }
  return prev;
}

function widthStillValid(b: Builder, s0: number, s1: number): boolean {
  const ids = rangeIndices(b, s0, s1);
  for (const i of ids) {
    if (Math.abs(b.curvature[i] as number) * (b.hw[i] as number) * TRACK.MIN_RADIUS_MULT > 1) return false;
  }
  return clearanceOk(b.loop.xs, b.loop.ys, b.hw, b.step, ids);
}

function revertWidth(b: Builder, prev: Map<number, number>): void {
  for (const [i, v] of prev) b.hw[i] = v;
}

function point(b: Builder, s: number, lateral: number): { x: number; y: number; i: number } {
  const i = idx(b, s);
  return {
    x: (b.loop.xs[i] as number) + (b.nx[i] as number) * lateral,
    y: (b.loop.ys[i] as number) + (b.ny[i] as number) * lateral,
    i,
  };
}

function addBoostPad(b: Builder, s: number, lateral: number): void {
  const p = point(b, s, lateral);
  b.boostPads.push({
    s,
    cx: p.x,
    cy: p.y,
    tx: b.tx[p.i] as number,
    ty: b.ty[p.i] as number,
    nx: b.nx[p.i] as number,
    ny: b.ny[p.i] as number,
    halfLength: 46,
    halfWidth: 25,
    lateral,
  });
}

function placeSplit(b: Builder, rng: Rng): boolean {
  const len = 860;
  const s0 = findSpot(b, rng, len, 1 / 650, { avoidGates: true, margin: 140 });
  if (s0 === null) return false;
  const s1 = s0 + len;
  const ramp = 180;
  const prev = applyWidth(b, s0, s1, TRACK.WIDE_MULT, ramp);
  if (!widthStillValid(b, s0, s1)) {
    revertWidth(b, prev);
    return false;
  }
  const islandR = 22;
  const i0 = s0 + ramp + 40;
  const i1 = s1 - ramp - 40;
  const pts: number[] = [];
  for (let s = i0; s <= i1 + 0.5; s += 40) {
    const p = point(b, Math.min(s, i1), 0);
    pts.push(p.x, p.y);
  }
  const mean = meanCurv(b, i0, i1);
  const innerSide = Math.abs(mean) > 1 / 6000 ? Math.sign(mean) : rng.sign();
  b.obstacles.push({ type: 'island', id: b.nextId++, sStart: i0, sEnd: i1, points: pts, r: islandR });
  const wide = TRACK.HALF_WIDTH * TRACK.WIDE_MULT;
  const lane = wide - islandR;
  // Inner (shorter) lane: a dome growing out of the island → tight squeeze.
  const mid = (i0 + i1) / 2;
  const domeLat = innerSide * (islandR - 4);
  const dome = point(b, mid, domeLat);
  const rMax = Math.min(lane - 45, wide - (islandR - 4) - TRACK.MIN_PASSAGE - 12);
  b.obstacles.push({
    type: 'pulsar',
    id: b.nextId++,
    s: mid,
    cx: dome.x,
    cy: dome.y,
    side: innerSide,
    lateral: domeLat,
    rMin: 14,
    rMax,
    periodMs: Math.round(rng.range(1500, 2300)),
    phase: rng.range(0, TAU),
  });
  // Outer (longer) lane: a boost pad as the reward.
  addBoostPad(b, i0 + 70, -innerSide * (islandR + lane / 2));
  b.zones.push({ kind: 'split', sStart: s0, sEnd: s1, innerSide });
  b.occupied.push([s0, s1]);
  return true;
}

function placeTunnel(b: Builder, rng: Rng): boolean {
  const len = Math.round(rng.range(420, 640) / 10) * 10;
  const s0 = findSpot(b, rng, len, 1 / 140, { avoidGates: false, margin: 120 });
  if (s0 === null) return false;
  const s1 = s0 + len;
  const prev = applyWidth(b, s0, s1, TRACK.NARROW_MULT, 110);
  if (!widthStillValid(b, s0, s1)) {
    revertWidth(b, prev);
    return false;
  }
  b.zones.push({ kind: 'tunnel', sStart: s0, sEnd: s1 });
  b.occupied.push([s0, s1]);
  return true;
}

function placeSweeper(b: Builder, rng: Rng): boolean {
  const len = 440;
  const s0 = findSpot(b, rng, len, 1 / 520, { avoidGates: true, margin: 120 });
  if (s0 === null) return false;
  const s1 = s0 + len;
  const prev = applyWidth(b, s0, s1, TRACK.ARENA_MULT, 150);
  if (!widthStillValid(b, s0, s1)) {
    revertWidth(b, prev);
    return false;
  }
  const mid = (s0 + s1) / 2;
  const p = point(b, mid, 0);
  const hw = TRACK.HALF_WIDTH * TRACK.ARENA_MULT;
  const thickness = 9;
  const arm = hw - TRACK.MIN_PASSAGE - thickness - 2;
  b.obstacles.push({
    type: 'sweeper',
    id: b.nextId++,
    s: mid,
    cx: p.x,
    cy: p.y,
    arm,
    thickness,
    omega: rng.range(1.05, 1.85) * rng.sign(),
    phase: rng.range(0, TAU),
  });
  b.zones.push({ kind: 'arena', sStart: s0, sEnd: s1 });
  b.occupied.push([s0, s1]);
  return true;
}

function placeGate(b: Builder, rng: Rng): boolean {
  const len = 400;
  const s0 = findSpot(b, rng, len, 1 / 800, { avoidGates: true, margin: 120 });
  if (s0 === null) return false;
  const s1 = s0 + len;
  const mult = 1.25;
  const prev = applyWidth(b, s0, s1, mult, 140);
  if (!widthStillValid(b, s0, s1)) {
    revertWidth(b, prev);
    return false;
  }
  const mid = (s0 + s1) / 2;
  const p = point(b, mid, 0);
  const hw = TRACK.HALF_WIDTH * mult;
  const gapHalf = 37;
  b.obstacles.push({
    type: 'gate',
    id: b.nextId++,
    s: mid,
    cx: p.x,
    cy: p.y,
    nx: b.nx[p.i] as number,
    ny: b.ny[p.i] as number,
    reach: hw + 14,
    gapHalf,
    amplitude: hw - gapHalf - 12,
    omega: rng.range(1.1, 1.9),
    phase: rng.range(0, TAU),
    thickness: 8,
  });
  b.zones.push({ kind: 'arena', sStart: s0, sEnd: s1 });
  b.occupied.push([s0, s1]);
  return true;
}

function placeChicane(b: Builder, rng: Rng): boolean {
  const len = 500;
  const s0 = findSpot(b, rng, len, 1 / 650, { avoidGates: true, margin: 110 });
  if (s0 === null) return false;
  let side: number = rng.sign();
  const r = 10;
  for (let k = 0; k < 3; k++) {
    const s = s0 + 100 + k * 150;
    const i = idx(b, s);
    const hw = b.hw[i] as number;
    const outer = point(b, s, side * (hw + 12));
    const tip = point(b, s, side * hw * 0.1);
    b.obstacles.push({ type: 'fin', id: b.nextId++, s, side, ax: outer.x, ay: outer.y, bx: tip.x, by: tip.y, r });
    side = -side;
  }
  b.occupied.push([s0, s0 + len]);
  return true;
}

function placePulsar(b: Builder, rng: Rng): boolean {
  const len = 220;
  const s0 = findSpot(b, rng, len, 1 / 420, { avoidGates: true, margin: 110 });
  if (s0 === null) return false;
  const mid = s0 + len / 2;
  const i = idx(b, mid);
  const hw = b.hw[i] as number;
  const side = rng.sign();
  const lateral = side * (hw + 6);
  const p = point(b, mid, lateral);
  const rMax = Math.min(hw * 1.2, 2 * hw + 6 - TRACK.MIN_PASSAGE - 20);
  b.obstacles.push({
    type: 'pulsar',
    id: b.nextId++,
    s: mid,
    cx: p.x,
    cy: p.y,
    side,
    lateral,
    rMin: 22,
    rMax,
    periodMs: Math.round(rng.range(1400, 2400)),
    phase: rng.range(0, TAU),
  });
  b.occupied.push([s0, s0 + len]);
  return true;
}

function placeBoost(b: Builder, rng: Rng, maxCurv = 1 / 1000): boolean {
  const len = 360;
  const s0 = findSpot(b, rng, len, maxCurv, { avoidGates: false, margin: 60 });
  if (s0 === null) return false;
  const lateral = rng.pick([-0.42, 0, 0.42]) * TRACK.HALF_WIDTH;
  addBoostPad(b, s0 + 60, lateral);
  // Only the pad itself is reserved; the straight after it stays free for other features.
  b.occupied.push([s0, s0 + 140]);
  return true;
}

function makeGate(b: Builder, s: number): Gate {
  const i = idx(b, s);
  const hw = b.hw[i] as number;
  const cx = b.loop.xs[i] as number;
  const cy = b.loop.ys[i] as number;
  const nx = b.nx[i] as number;
  const ny = b.ny[i] as number;
  const reach = hw + 14;
  return {
    index: i,
    s: i * b.step,
    cx,
    cy,
    ax: cx - nx * reach,
    ay: cy - ny * reach,
    bx: cx + nx * reach,
    by: cy + ny * reach,
    tx: b.tx[i] as number,
    ty: b.ty[i] as number,
    halfWidth: hw,
  };
}

function trackName(arch: Archetype, rng: Rng): string {
  return `${rng.pick(ADJECTIVES)} ${rng.pick(arch.nouns)}`;
}

function assemble(
  dateKey: string,
  seed: number,
  arch: Archetype,
  baseLoop: Loop,
  rng: Rng,
  attempts: number,
): Track {
  // Direction and start line on the straightest stretch.
  let loop = rng.chance(0.5) ? reverseLoop(baseLoop) : baseLoop;
  const curv0 = computeCurvature(loop);
  const n0 = loop.xs.length;
  let bestStart = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < n0; i += 2) {
    let score = 0;
    for (let k = -16; k <= 42; k++) score += Math.abs(curv0[(i + k + n0) % n0] as number);
    if (score < bestScore) {
      bestScore = score;
      bestStart = i;
    }
  }
  loop = rotateLoop(loop, bestStart);
  const n = loop.xs.length;
  const frames = computeFrames(loop);
  const step = loopLength(loop) / n;
  const b: Builder = {
    loop,
    n,
    step,
    length: n * step,
    ...frames,
    curvature: computeCurvature(loop),
    hw: new Float64Array(n).fill(TRACK.HALF_WIDTH),
    occupied: [],
    gatesS: [],
    obstacles: [],
    boostPads: [],
    zones: [],
    nextId: 1,
  };

  const cpCount = clamp(Math.round(b.length / 1700), 4, 6);
  for (let k = 1; k <= cpCount; k++) b.gatesS.push((b.length * k) / (cpCount + 1));

  const count = (range: readonly [number, number]): number => rng.int(range[0], range[1]);
  const order: Array<[FeatureKind, number]> = [
    ['split', count(arch.plan.split)],
    ['tunnel', count(arch.plan.tunnel)],
    ['sweeper', count(arch.plan.sweeper)],
    ['gate', count(arch.plan.gate)],
    ['chicane', count(arch.plan.chicane)],
    ['pulsar', count(arch.plan.pulsar)],
    ['boost', count(arch.plan.boost)],
  ];
  const placers: Record<FeatureKind, (bb: Builder, r: Rng) => boolean> = {
    split: placeSplit,
    tunnel: placeTunnel,
    sweeper: placeSweeper,
    gate: placeGate,
    chicane: placeChicane,
    pulsar: placePulsar,
    boost: placeBoost,
  };
  for (const [kind, wanted] of order) {
    for (let k = 0; k < wanted; k++) placers[kind](b, rng);
  }
  // Every circuit gets at least one boost and one dynamic hazard.
  if (b.boostPads.length === 0 && !placeBoost(b, rng, 1 / 500)) placeBoost(b, rng, 1 / 250);
  if (!b.obstacles.some((o) => o.type === 'sweeper' || o.type === 'pulsar' || o.type === 'gate')) {
    if (!placePulsar(b, rng)) placeSweeper(b, rng);
  }

  // Arc lengths & bounds.
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) s[i] = i * b.step;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const pad = (b.hw[i] as number) + 40;
    minX = Math.min(minX, (loop.xs[i] as number) - pad);
    minY = Math.min(minY, (loop.ys[i] as number) - pad);
    maxX = Math.max(maxX, (loop.xs[i] as number) + pad);
    maxY = Math.max(maxY, (loop.ys[i] as number) + pad);
  }

  const startLine = makeGate(b, 0);
  const checkpoints = b.gatesS.map((gs) => makeGate(b, gs));
  const t0x = b.tx[0] as number;
  const t0y = b.ty[0] as number;
  const spawn = {
    x: (loop.xs[0] as number) - t0x * TRACK.SPAWN_BACK,
    y: (loop.ys[0] as number) - t0y * TRACK.SPAWN_BACK,
    angle: Math.atan2(t0y, t0x),
  };

  b.obstacles.sort((a, c) => obstacleS(a) - obstacleS(c));
  b.boostPads.sort((a, c) => a.s - c.s);
  b.zones.sort((a, c) => a.sStart - c.sStart);

  return {
    dateKey,
    seed,
    name: trackName(arch, rng),
    archetype: arch.id,
    archetypeLabel: arch.label,
    circuitNo: circuitNumber(dateKey),
    clockwise: signedArea(loop) > 0,
    n,
    step: b.step,
    length: b.length,
    xs: loop.xs,
    ys: loop.ys,
    tx: b.tx,
    ty: b.ty,
    nx: b.nx,
    ny: b.ny,
    hw: b.hw,
    s,
    curvature: b.curvature,
    bounds: { minX, minY, maxX, maxY },
    spawn,
    startBox: { along: 70, lateral: TRACK.HALF_WIDTH },
    startLine,
    checkpoints,
    boostPads: b.boostPads,
    obstacles: b.obstacles,
    zones: b.zones,
    generationAttempts: attempts,
  };
}

function obstacleS(o: ObstacleDef): number {
  return o.type === 'island' ? o.sStart : o.s;
}

function signedArea(loop: Loop): number {
  const n = loop.xs.length;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += (loop.xs[i] as number) * (loop.ys[j] as number) - (loop.xs[j] as number) * (loop.ys[i] as number);
  }
  return a / 2;
}

const cache = new Map<string, Track>();

/** Pick today's archetype: deterministic and never the same as yesterday's. */
export function archetypeFor(dateKey: string): ArchetypeId {
  return pickArchetype(dateKey).id;
}

function pickArchetype(dateKey: string): Archetype {
  const flip = hashString(`arch:${dateKey}`) & 1;
  const i = (2 * dayIndex(dateKey) + flip) % ARCHETYPES.length;
  return ARCHETYPES[(i + ARCHETYPES.length) % ARCHETYPES.length] as Archetype;
}

/** Generate (or fetch from cache) the circuit for a UTC date key. */
export function generateTrack(dateKey: string): Track {
  const cached = cache.get(dateKey);
  if (cached) return cached;
  const seed = hashString(`ghost-circuit:${dateKey}`);
  const rng = new Rng(seed);
  const arch = pickArchetype(dateKey);
  let track: Track | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !track; attempt++) {
    const loop = buildBaseLoop(arch, rng);
    if (loop) track = assemble(dateKey, seed, arch, loop, rng, attempt);
  }
  if (!track) {
    const fallback = buildFallbackLoop(rng);
    track = assemble(dateKey, seed, arch, fallback, rng, MAX_ATTEMPTS + 1);
  }
  if (cache.size > 8) cache.clear();
  cache.set(dateKey, track);
  return track;
}

/** Exposed for tests. */
export const __internal = { clearanceOk, computeCurvature, tightSamples, CAR_RADIUS: CAR.RADIUS };
