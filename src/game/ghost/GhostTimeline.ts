/**
 * Pure playback model for a decoded ghost: interpolated pose at any race time
 * plus a monotonic progress curve used for live split deltas.
 */
import { GHOST } from '../config';
import { createProjection, projectGlobal, projectLocal, unwrapProgress } from '../track/TrackQuery';
import type { Track } from '../track/TrackTypes';
import { lerpAngle } from '../util/math';
import type { GhostFrames } from './GhostCodec';

export type GhostPose = {
  x: number;
  y: number;
  r: number;
  boosting: boolean;
  finished: boolean;
};

export class GhostTimeline {
  readonly count: number;
  readonly t: Float64Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly r: Float64Array;
  readonly b: Uint8Array;
  /** Unwrapped, monotonic (running max) lap progress per frame. */
  readonly progress: Float64Array;
  readonly finishMs: number;
  private cursor = 0;

  constructor(frames: GhostFrames, track: Track) {
    const n = frames.count;
    this.count = n;
    this.t = new Float64Array(n);
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.r = new Float64Array(n);
    this.b = new Uint8Array(n);
    this.progress = new Float64Array(n);
    const proj = createProjection();
    let prev = -track.length * 0.01;
    let hint = -1;
    let runningMax = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      const x = (frames.x[i] as number) / GHOST.POS_SCALE;
      const y = (frames.y[i] as number) / GHOST.POS_SCALE;
      this.t[i] = frames.t[i] as number;
      this.x[i] = x;
      this.y[i] = y;
      this.r[i] = (frames.r[i] as number) / GHOST.ROT_SCALE;
      this.b[i] = frames.b[i] as number;
      if (hint < 0) projectGlobal(track, x, y, proj);
      else projectLocal(track, x, y, hint, proj);
      hint = proj.seg;
      prev = unwrapProgress(proj.s, i === 0 ? 0 : prev, track.length);
      if (i === 0 && prev > track.length * 0.5) prev -= track.length;
      runningMax = Math.max(runningMax, prev);
      this.progress[i] = runningMax;
    }
    this.finishMs = n > 0 ? (this.t[n - 1] as number) : 0;
  }

  /** Index k with t[k] <= tMs < t[k+1] (clamped), using a playback cursor. */
  private locate(tMs: number): number {
    const t = this.t;
    const last = this.count - 1;
    let k = this.cursor;
    if (k > last) k = last;
    if ((t[k] as number) > tMs) {
      // Jumped backwards (restart): binary search.
      let lo = 0;
      let hi = last;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if ((t[mid] as number) <= tMs) lo = mid;
        else hi = mid - 1;
      }
      k = lo;
    } else {
      while (k < last && (t[k + 1] as number) <= tMs) k++;
    }
    this.cursor = k;
    return k;
  }

  /** Interpolated pose at race time tMs (frozen on the finish frame). */
  sample(tMs: number, out: GhostPose): GhostPose {
    const last = this.count - 1;
    if (tMs >= this.finishMs) {
      out.x = this.x[last] as number;
      out.y = this.y[last] as number;
      out.r = this.r[last] as number;
      out.boosting = false;
      out.finished = true;
      return out;
    }
    const k = this.locate(Math.max(0, tMs));
    const k1 = Math.min(last, k + 1);
    const t0 = this.t[k] as number;
    const t1 = this.t[k1] as number;
    const u = t1 > t0 ? Math.min(1, Math.max(0, (tMs - t0) / (t1 - t0))) : 0;
    out.x = (this.x[k] as number) + ((this.x[k1] as number) - (this.x[k] as number)) * u;
    out.y = (this.y[k] as number) + ((this.y[k1] as number) - (this.y[k] as number)) * u;
    out.r = lerpAngle(this.r[k] as number, this.r[k1] as number, u);
    out.boosting = (this.b[k] as number) === 1;
    out.finished = false;
    return out;
  }

  /** Race time at which this ghost first reached `progress` (unwrapped units). */
  timeAtProgress(progress: number): number {
    const p = this.progress;
    const last = this.count - 1;
    if (progress <= (p[0] as number)) return 0;
    if (progress >= (p[last] as number)) return this.finishMs;
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((p[mid] as number) < progress) lo = mid;
      else hi = mid;
    }
    const p0 = p[lo] as number;
    const p1 = p[hi] as number;
    const u = p1 > p0 ? (progress - p0) / (p1 - p0) : 0;
    return (this.t[lo] as number) + ((this.t[hi] as number) - (this.t[lo] as number)) * u;
  }

  /** Recent positions for trail rendering (newest last). */
  trailIndex(tMs: number): number {
    if (tMs >= this.finishMs) return this.count - 1;
    return this.locate(Math.max(0, tMs));
  }
}
