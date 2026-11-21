/**
 * Race-clock-synchronised obstacles.
 *
 * Every dynamic obstacle's shape is a PURE FUNCTION of the race clock
 * (elapsedMs). No wall-clock time, no frame counts, no internal state — so the
 * player, every ghost and the validator all see each obstacle in exactly the
 * same place at every millisecond of a run.
 */
import { TAU } from '../util/math';
import type { ObstacleDef } from './TrackTypes';

/** A capsule collider (segment + radius) with endpoint velocities. */
export type Collider = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
  /** Velocity of endpoint A and B, units/s. */
  avx: number;
  avy: number;
  bvx: number;
  bvy: number;
  /** Radial growth speed (pulsars), units/s. */
  radialVel: number;
  /** Dynamic hazards bounce harder and flash; static ones behave like walls. */
  hazard: boolean;
  obstacleId: number;
  /** Broad-phase bounding circle. */
  cx: number;
  cy: number;
  extent: number;
};

/** Pre-allocated collider storage — no per-tick allocations. */
export class ColliderPool {
  readonly items: Collider[] = [];
  count = 0;

  reset(): void {
    this.count = 0;
  }

  push(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    r: number,
    avx: number,
    avy: number,
    bvx: number,
    bvy: number,
    radialVel: number,
    hazard: boolean,
    obstacleId: number,
  ): void {
    let c = this.items[this.count];
    if (!c) {
      c = {
        ax: 0, ay: 0, bx: 0, by: 0, r: 0, avx: 0, avy: 0, bvx: 0, bvy: 0,
        radialVel: 0, hazard: false, obstacleId: 0, cx: 0, cy: 0, extent: 0,
      };
      this.items.push(c);
    }
    c.ax = ax;
    c.ay = ay;
    c.bx = bx;
    c.by = by;
    c.r = r;
    c.avx = avx;
    c.avy = avy;
    c.bvx = bvx;
    c.bvy = bvy;
    c.radialVel = radialVel;
    c.hazard = hazard;
    c.obstacleId = obstacleId;
    c.cx = (ax + bx) * 0.5;
    c.cy = (ay + by) * 0.5;
    const hx = (bx - ax) * 0.5;
    const hy = (by - ay) * 0.5;
    c.extent = Math.sqrt(hx * hx + hy * hy) + r;
    this.count++;
  }
}

/** Sweeper bar angle at race time t (ms). */
export function sweeperAngle(omega: number, phase: number, tMs: number): number {
  return phase + (omega * tMs) / 1000;
}

/** Pulsar radius at race time t (ms). */
export function pulsarRadius(rMin: number, rMax: number, periodMs: number, phase: number, tMs: number): number {
  const k = 0.5 - 0.5 * Math.cos((TAU * tMs) / periodMs + phase);
  return rMin + (rMax - rMin) * k;
}

/** Pulsar growth rate (units/s) at race time t (ms). */
export function pulsarRadialVelocity(rMin: number, rMax: number, periodMs: number, phase: number, tMs: number): number {
  const w = TAU / periodMs; // rad per ms
  return (rMax - rMin) * 0.5 * Math.sin(w * tMs + phase) * w * 1000;
}

/** Lateral offset of a sliding gate's gap center at race time t (ms). */
export function gateGapOffset(amplitude: number, omega: number, phase: number, tMs: number): number {
  return amplitude * Math.sin((omega * tMs) / 1000 + phase);
}

/** Write every obstacle's colliders for race time t into the pool. */
export function collectColliders(defs: readonly ObstacleDef[], tMs: number, pool: ColliderPool): void {
  pool.reset();
  for (const d of defs) {
    switch (d.type) {
      case 'sweeper': {
        const a = sweeperAngle(d.omega, d.phase, tMs);
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const ex = ca * d.arm;
        const ey = sa * d.arm;
        // Endpoint velocity = ω × r (perpendicular to the arm).
        const vx = -sa * d.arm * d.omega;
        const vy = ca * d.arm * d.omega;
        pool.push(d.cx + ex, d.cy + ey, d.cx - ex, d.cy - ey, d.thickness, vx, vy, -vx, -vy, 0, true, d.id);
        break;
      }
      case 'pulsar': {
        const r = pulsarRadius(d.rMin, d.rMax, d.periodMs, d.phase, tMs);
        const rv = pulsarRadialVelocity(d.rMin, d.rMax, d.periodMs, d.phase, tMs);
        pool.push(d.cx, d.cy, d.cx, d.cy, r, 0, 0, 0, 0, rv, true, d.id);
        break;
      }
      case 'gate': {
        const c = gateGapOffset(d.amplitude, d.omega, d.phase, tMs);
        const dc = d.amplitude * Math.cos((d.omega * tMs) / 1000 + d.phase) * d.omega;
        const vx = d.nx * dc;
        const vy = d.ny * dc;
        const t = d.thickness;
        // Left block: from -reach to (c - gapHalf - t); right block: (c + gapHalf + t) to +reach.
        const l0 = -d.reach;
        const l1 = c - d.gapHalf - t;
        const r0 = c + d.gapHalf + t;
        const r1 = d.reach;
        if (l1 > l0) {
          pool.push(
            d.cx + d.nx * l0, d.cy + d.ny * l0, d.cx + d.nx * l1, d.cy + d.ny * l1,
            t, 0, 0, vx, vy, 0, true, d.id,
          );
        }
        if (r1 > r0) {
          pool.push(
            d.cx + d.nx * r0, d.cy + d.ny * r0, d.cx + d.nx * r1, d.cy + d.ny * r1,
            t, vx, vy, 0, 0, 0, true, d.id,
          );
        }
        break;
      }
      case 'fin':
        pool.push(d.ax, d.ay, d.bx, d.by, d.r, 0, 0, 0, 0, 0, false, d.id);
        break;
      case 'island': {
        const p = d.points;
        for (let i = 0; i + 3 < p.length; i += 2) {
          pool.push(
            p[i] as number, p[i + 1] as number, p[i + 2] as number, p[i + 3] as number,
            d.r, 0, 0, 0, 0, 0, false, d.id,
          );
        }
        break;
      }
    }
  }
}
