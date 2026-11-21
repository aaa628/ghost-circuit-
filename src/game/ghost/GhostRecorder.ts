/**
 * Records the player's telemetry at 30 Hz (every 2 physics ticks) into
 * pre-allocated typed arrays, quantized at capture time so the ghost that is
 * replayed locally is bit-identical to the one other players download.
 */
import { GHOST } from '../config';
import { wrapAngle } from '../util/math';
import { allocFrames, encodeGhost, type GhostFrames } from './GhostCodec';

export class GhostRecorder {
  private readonly frames: GhostFrames = allocFrames(GHOST.MAX_FRAMES);
  private finished = false;

  reset(): void {
    this.frames.count = 0;
    this.finished = false;
  }

  get count(): number {
    return this.frames.count;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  /** Append a sample. Times must increase; equal/older samples are ignored. */
  sample(tMs: number, x: number, y: number, angle: number, boosting: boolean): void {
    if (this.finished) return;
    const f = this.frames;
    if (f.count >= GHOST.MAX_FRAMES - 1) return; // keep one slot for the finish frame
    const t = Math.round(tMs);
    if (f.count > 0 && t <= (f.t[f.count - 1] as number)) return;
    this.write(f.count, t, x, y, angle, boosting);
    f.count++;
  }

  /** Write the exact finish frame (the crossing point at the finish time). */
  finish(tMs: number, x: number, y: number, angle: number, boosting: boolean): void {
    if (this.finished) return;
    const f = this.frames;
    const t = Math.round(tMs);
    while (f.count > 1 && (f.t[f.count - 1] as number) >= t) f.count--;
    this.write(f.count, t, x, y, angle, boosting);
    f.count++;
    this.finished = true;
  }

  private write(i: number, t: number, x: number, y: number, angle: number, boosting: boolean): void {
    const f = this.frames;
    f.t[i] = t;
    f.x[i] = Math.round(x * GHOST.POS_SCALE);
    f.y[i] = Math.round(y * GHOST.POS_SCALE);
    f.r[i] = Math.round(wrapAngle(angle) * GHOST.ROT_SCALE);
    f.b[i] = boosting ? 1 : 0;
  }

  /** A trimmed copy of the recorded frames. */
  snapshot(): GhostFrames {
    const f = this.frames;
    const n = f.count;
    return {
      count: n,
      t: f.t.slice(0, n),
      x: f.x.slice(0, n),
      y: f.y.slice(0, n),
      r: f.r.slice(0, n),
      b: f.b.slice(0, n),
    };
  }

  encode(): string {
    return encodeGhost(this.snapshot());
  }
}
