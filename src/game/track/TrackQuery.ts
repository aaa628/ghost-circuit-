/** Spatial queries against a track's centerline tube. Allocation-free. */
import { closestParamOnSegment, segmentIntersect } from '../util/math';
import type { Gate, Track } from './TrackTypes';

export type Projection = {
  /** Segment index (sample i → i+1). */
  seg: number;
  /** Parameter along the segment, 0..1. */
  u: number;
  /** Closest centerline point. */
  cx: number;
  cy: number;
  /** Distance from the centerline. */
  dist: number;
  /** Signed lateral offset along the segment normal. */
  lateral: number;
  /** Arc length position (0..length). */
  s: number;
  /** Interpolated half-width at the projection. */
  hw: number;
  /** Segment normal. */
  nx: number;
  ny: number;
};

export function createProjection(): Projection {
  return { seg: 0, u: 0, cx: 0, cy: 0, dist: 0, lateral: 0, s: 0, hw: 0, nx: 0, ny: 1 };
}

function evalSegment(track: Track, i: number, px: number, py: number, out: Projection): number {
  const n = track.n;
  const j = i + 1 === n ? 0 : i + 1;
  const ax = track.xs[i] as number;
  const ay = track.ys[i] as number;
  const bx = track.xs[j] as number;
  const by = track.ys[j] as number;
  const u = closestParamOnSegment(px, py, ax, ay, bx, by);
  const cx = ax + (bx - ax) * u;
  const cy = ay + (by - ay) * u;
  const dx = px - cx;
  const dy = py - cy;
  const d2 = dx * dx + dy * dy;
  out.seg = i;
  out.u = u;
  out.cx = cx;
  out.cy = cy;
  out.dist = d2;
  return d2;
}

const scratch = createProjection();

function finalize(track: Track, px: number, py: number, out: Projection): Projection {
  const n = track.n;
  const i = out.seg;
  const j = i + 1 === n ? 0 : i + 1;
  const ax = track.xs[i] as number;
  const ay = track.ys[i] as number;
  const bx = track.xs[j] as number;
  const by = track.ys[j] as number;
  let sx = bx - ax;
  let sy = by - ay;
  const len = Math.sqrt(sx * sx + sy * sy) || 1;
  sx /= len;
  sy /= len;
  out.nx = -sy;
  out.ny = sx;
  out.dist = Math.sqrt(out.dist);
  out.lateral = (px - out.cx) * out.nx + (py - out.cy) * out.ny;
  const hwA = track.hw[i] as number;
  const hwB = track.hw[j] as number;
  out.hw = hwA + (hwB - hwA) * out.u;
  out.s = (track.s[i] as number) + len * out.u;
  if (out.s >= track.length) out.s -= track.length;
  return out;
}

/** Brute-force projection over every segment. */
export function projectGlobal(track: Track, px: number, py: number, out: Projection): Projection {
  let best = Number.POSITIVE_INFINITY;
  let bestSeg = 0;
  let bestU = 0;
  let bestCx = 0;
  let bestCy = 0;
  for (let i = 0; i < track.n; i++) {
    const d2 = evalSegment(track, i, px, py, scratch);
    if (d2 < best) {
      best = d2;
      bestSeg = i;
      bestU = scratch.u;
      bestCx = scratch.cx;
      bestCy = scratch.cy;
    }
  }
  out.seg = bestSeg;
  out.u = bestU;
  out.cx = bestCx;
  out.cy = bestCy;
  out.dist = best;
  return finalize(track, px, py, out);
}

/**
 * Projection that searches a window of segments around a hint (the previous
 * result), falling back to a global search when the hint looks wrong.
 */
export function projectLocal(
  track: Track,
  px: number,
  py: number,
  hint: number,
  out: Projection,
  window = 28,
): Projection {
  const n = track.n;
  let best = Number.POSITIVE_INFINITY;
  let bestSeg = 0;
  let bestU = 0;
  let bestCx = 0;
  let bestCy = 0;
  let bestK = 0;
  for (let k = -window; k <= window; k++) {
    let i = (hint + k) % n;
    if (i < 0) i += n;
    const d2 = evalSegment(track, i, px, py, scratch);
    if (d2 < best) {
      best = d2;
      bestSeg = i;
      bestU = scratch.u;
      bestCx = scratch.cx;
      bestCy = scratch.cy;
      bestK = k;
    }
  }
  const maxHw = 200;
  if (best > maxHw * maxHw || bestK === -window || bestK === window) {
    return projectGlobal(track, px, py, out);
  }
  out.seg = bestSeg;
  out.u = bestU;
  out.cx = bestCx;
  out.cy = bestCy;
  out.dist = best;
  return finalize(track, px, py, out);
}

/**
 * Parameter (0..1) along the motion segment where it crosses the gate in the
 * forward direction, or -1.
 */
export function gateCrossing(
  gate: Gate,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  extend = 0,
): number {
  const mx = x1 - x0;
  const my = y1 - y0;
  if (mx * gate.tx + my * gate.ty <= 0) return -1;
  let ax = gate.ax;
  let ay = gate.ay;
  let bx = gate.bx;
  let by = gate.by;
  if (extend > 0) {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const ex = (dx / len) * extend;
    const ey = (dy / len) * extend;
    ax -= ex;
    ay -= ey;
    bx += ex;
    by += ey;
  }
  return segmentIntersect(x0, y0, x1, y1, ax, ay, bx, by);
}

/** Signed distance of a point past a gate line along its forward direction. */
export function signedGateDistance(gate: Gate, x: number, y: number): number {
  return (x - gate.cx) * gate.tx + (y - gate.cy) * gate.ty;
}

/** Index of the sample nearest to arc length s. */
export function indexAt(track: Track, s: number): number {
  const L = track.length;
  let w = s % L;
  if (w < 0) w += L;
  return Math.round(w / track.step) % track.n;
}

/** Unwrap a raw arc position (0..L) next to a previous unwrapped value. */
export function unwrapProgress(raw: number, previous: number, length: number): number {
  const laps = Math.round((previous - raw) / length);
  return raw + laps * length;
}
