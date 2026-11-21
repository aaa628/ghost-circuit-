/**
 * Fixed-timestep arcade car physics.
 *
 * One call to `step()` advances exactly FIXED_DT (1/60 s). The model is a
 * heading + world-velocity integrator:
 *   1. steering slews toward the input and rotates the heading (authority
 *      scales with speed; reversing inverts it; drift multiplies it),
 *   2. velocity is decomposed onto the new heading — throttle/brake/drag act
 *      on the forward part, grip bleeds the lateral part (low grip = drift)
 *      and redirects some of it forward,
 *   3. capsule obstacles and the track tube resolve collisions with a
 *      proportional speed penalty, a small bounce and gentle wall alignment.
 * The tube constraint projects the car back inside the walls every tick, so
 * it can never snag on or tunnel through geometry.
 */
import { CAR, COLLISION, FIXED_DT, FIXED_DT_S } from '../config';
import type { ColliderPool } from '../track/Obstacles';
import { createProjection, projectGlobal, projectLocal, type Projection } from '../track/TrackQuery';
import type { Track } from '../track/TrackTypes';
import { angleDelta, clamp, closestParamOnSegment, wrapAngle } from '../util/math';

export type CarInput = {
  /** 0..1 */
  throttle: number;
  /** 0..1 (brake, then reverse) */
  brake: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
  drift: boolean;
};

export const NO_INPUT: Readonly<CarInput> = { throttle: 0, brake: 0, steer: 0, drift: false };

export type CarState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  /** Smoothed steering position, -1..1. */
  steer: number;
  boostMs: number;
  drifting: boolean;
  /** Index of the boost pad the car is touching, or -1. */
  onPad: number;
  /** Track segment hint for fast projection. */
  hint: number;
  speed: number;
  forwardSpeed: number;
  lateralSpeed: number;
  wallContact: boolean;
};

export type StepReport = {
  wallImpact: number;
  obstacleImpact: number;
  hazardHit: boolean;
  boostTriggered: boolean;
  impactX: number;
  impactY: number;
};

const GRIP_KEEP = Math.exp(-CAR.GRIP * FIXED_DT_S);
const DRIFT_KEEP = Math.exp(-CAR.DRIFT_GRIP * FIXED_DT_S);

export class CarController {
  readonly state: CarState = {
    x: 0, y: 0, vx: 0, vy: 0, angle: 0, steer: 0, boostMs: 0, drifting: false,
    onPad: -1, hint: 0, speed: 0, forwardSpeed: 0, lateralSpeed: 0, wallContact: false,
  };
  readonly report: StepReport = {
    wallImpact: 0, obstacleImpact: 0, hazardHit: false, boostTriggered: false, impactX: 0, impactY: 0,
  };
  readonly projection: Projection = createProjection();

  constructor(private readonly track: Track) {
    this.reset();
  }

  reset(): void {
    const s = this.state;
    const sp = this.track.spawn;
    s.x = sp.x;
    s.y = sp.y;
    s.vx = 0;
    s.vy = 0;
    s.angle = sp.angle;
    s.steer = 0;
    s.boostMs = 0;
    s.drifting = false;
    s.onPad = -1;
    s.speed = 0;
    s.forwardSpeed = 0;
    s.lateralSpeed = 0;
    s.wallContact = false;
    projectGlobal(this.track, s.x, s.y, this.projection);
    s.hint = this.projection.seg;
    this.clearReport();
  }

  private clearReport(): void {
    const r = this.report;
    r.wallImpact = 0;
    r.obstacleImpact = 0;
    r.hazardHit = false;
    r.boostTriggered = false;
    r.impactX = 0;
    r.impactY = 0;
  }

  step(input: CarInput, colliders: ColliderPool): StepReport {
    const s = this.state;
    const dt = FIXED_DT_S;
    this.clearReport();
    const speedIn = Math.sqrt(s.vx * s.vx + s.vy * s.vy);

    // ── Steering ──
    const target = clamp(input.steer, -1, 1);
    const maxDelta = CAR.STEER_RATE * dt;
    s.steer += clamp(target - s.steer, -maxDelta, maxDelta);

    let fx = Math.cos(s.angle);
    let fy = Math.sin(s.angle);
    let vf = s.vx * fx + s.vy * fy;
    s.drifting = input.drift && vf > CAR.DRIFT_MIN_SPEED;

    const absVf = Math.abs(vf);
    const authority = clamp(absVf / CAR.TURN_SPEED_REF, 0, 1);
    const falloff = 1 - CAR.TURN_HIGH_SPEED_FALLOFF * clamp(absVf / CAR.MAX_SPEED, 0, 1.4);
    const turn = CAR.TURN_RATE * authority * falloff * (s.drifting ? CAR.DRIFT_TURN_MULT : 1);
    const dir = vf >= -5 ? 1 : -1;
    s.angle = wrapAngle(s.angle + s.steer * turn * dir * dt);

    // ── Longitudinal + lateral on the new heading ──
    fx = Math.cos(s.angle);
    fy = Math.sin(s.angle);
    const rx = -fy;
    const ry = fx;
    vf = s.vx * fx + s.vy * fy;
    let vr = s.vx * rx + s.vy * ry;

    const boosting = s.boostMs > 0;
    const vmax = boosting ? CAR.BOOST_MAX_SPEED : CAR.MAX_SPEED;
    const accel = CAR.ACCEL * (boosting ? CAR.BOOST_ACCEL_MULT : 1);
    const throttle = clamp(input.throttle, 0, 1);
    const brake = clamp(input.brake, 0, 1);

    if (throttle > 0) {
      if (vf < 0) vf = Math.min(0, vf + CAR.BRAKE * throttle * dt);
      else {
        // The engine limits TOTAL speed: while the car is sliding sideways the
        // forward part may only grow until |v| reaches vmax.
        const room = Math.sqrt(Math.max(0, vmax * vmax - vr * vr));
        if (vf < room) vf = Math.min(room, vf + accel * throttle * dt);
      }
    }
    if (brake > 0) {
      if (vf > 0) vf = Math.max(0, vf - CAR.BRAKE * brake * dt);
      else if (vf > -CAR.REVERSE_MAX) vf = Math.max(-CAR.REVERSE_MAX, vf - CAR.REVERSE_ACCEL * brake * dt);
    }
    if (throttle <= 0 && brake <= 0) vf -= vf * CAR.COAST_DRAG * dt;
    vf -= vf * CAR.ROLL_DRAG * dt;
    if (vf > vmax) vf -= (vf - vmax) * CAR.OVERSPEED_DECAY * dt;

    const keep = s.drifting ? DRIFT_KEEP : GRIP_KEEP;
    const newVr = vr * keep;
    const bled = Math.abs(vr) - Math.abs(newVr);
    if (vf > 0) vf += bled * CAR.SLIP_REDIRECT;
    else if (vf < 0) vf -= bled * CAR.SLIP_REDIRECT * 0.5;
    if (s.drifting) vf -= vf * CAR.DRIFT_DRAG * dt;
    vr = newVr;

    // Energy guard: grip redirection may give back speed that sliding cost,
    // but never create it. Total speed may not exceed vmax, or — above vmax
    // (after a boost) — what the car had this tick minus the over-speed decay.
    // Without this, weaving converts lateral slip into forward speed every
    // swerve and the car sustains ~1.4× MAX_SPEED with no boost.
    const allowed = speedIn > vmax ? vmax + (speedIn - vmax) * (1 - CAR.OVERSPEED_DECAY * dt) : vmax;
    if (vf > 0 && vf * vf + vr * vr > allowed * allowed) {
      vf = Math.sqrt(Math.max(0, allowed * allowed - vr * vr));
    }

    s.vx = fx * vf + rx * vr;
    s.vy = fy * vf + ry * vr;
    let speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
    if (speed > CAR.HARD_SPEED_CAP) {
      const k = CAR.HARD_SPEED_CAP / speed;
      s.vx *= k;
      s.vy *= k;
      speed = CAR.HARD_SPEED_CAP;
    }

    // ── Integrate ──
    s.x += s.vx * dt;
    s.y += s.vy * dt;

    // ── Obstacles ──
    this.resolveObstacles(colliders);

    // ── Walls (always last: the car must end the tick inside the tube) ──
    this.resolveWalls(speed);

    // ── Boost pads ──
    this.checkBoostPads();
    if (s.boostMs > 0) s.boostMs = Math.max(0, s.boostMs - FIXED_DT);

    fx = Math.cos(s.angle);
    fy = Math.sin(s.angle);
    s.forwardSpeed = s.vx * fx + s.vy * fy;
    s.lateralSpeed = -s.vx * fy + s.vy * fx;
    s.speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
    return this.report;
  }

  private resolveObstacles(colliders: ColliderPool): void {
    const s = this.state;
    const R = CAR.RADIUS;
    for (let k = 0; k < colliders.count; k++) {
      const c = colliders.items[k];
      if (!c) continue;
      const bx = s.x - c.cx;
      const by = s.y - c.cy;
      const reach = c.extent + R + 2;
      if (bx * bx + by * by > reach * reach) continue;
      const u = closestParamOnSegment(s.x, s.y, c.ax, c.ay, c.bx, c.by);
      const qx = c.ax + (c.bx - c.ax) * u;
      const qy = c.ay + (c.by - c.ay) * u;
      let dx = s.x - qx;
      let dy = s.y - qy;
      const minD = c.r + R;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minD * minD) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-6) {
        // Dead center: push perpendicular to the capsule axis (or along heading).
        const ax = c.bx - c.ax;
        const ay = c.by - c.ay;
        const al = Math.sqrt(ax * ax + ay * ay);
        if (al > 1e-6) {
          dx = -ay / al;
          dy = ax / al;
        } else {
          dx = -Math.cos(s.angle);
          dy = -Math.sin(s.angle);
        }
        d = 1;
      } else {
        dx /= d;
        dy /= d;
      }
      s.x = qx + dx * minD;
      s.y = qy + dy * minD;
      const ovx = c.avx + (c.bvx - c.avx) * u + dx * c.radialVel;
      const ovy = c.avy + (c.bvy - c.avy) * u + dy * c.radialVel;
      let relx = s.vx - ovx;
      let rely = s.vy - ovy;
      const vn = relx * dx + rely * dy;
      if (vn < 0) {
        const e = c.hazard ? COLLISION.OBSTACLE_RESTITUTION : COLLISION.WALL_RESTITUTION;
        relx -= (1 + e) * vn * dx;
        rely -= (1 + e) * vn * dy;
        const friction = c.hazard ? COLLISION.OBSTACLE_FRICTION : COLLISION.WALL_FRICTION;
        const maxPen = c.hazard ? COLLISION.OBSTACLE_MAX_PENALTY : COLLISION.WALL_MAX_PENALTY;
        const pen = clamp((friction * -vn) / CAR.MAX_SPEED, 0, maxPen);
        relx *= 1 - pen;
        rely *= 1 - pen;
        s.vx = relx + ovx;
        s.vy = rely + ovy;
        if (-vn > this.report.obstacleImpact) {
          this.report.obstacleImpact = -vn;
          this.report.hazardHit = c.hazard;
          this.report.impactX = qx + dx * c.r;
          this.report.impactY = qy + dy * c.r;
        }
      }
    }
  }

  private resolveWalls(speedBefore: number): void {
    const s = this.state;
    const p = projectLocal(this.track, s.x, s.y, s.hint, this.projection);
    s.hint = p.seg;
    const limit = p.hw - CAR.RADIUS;
    s.wallContact = false;
    if (p.dist <= limit) return;
    s.wallContact = true;
    let ox: number;
    let oy: number;
    if (p.dist > 1e-6) {
      ox = (s.x - p.cx) / p.dist;
      oy = (s.y - p.cy) / p.dist;
    } else {
      ox = p.nx;
      oy = p.ny;
    }
    s.x = p.cx + ox * limit;
    s.y = p.cy + oy * limit;
    const vn = s.vx * ox + s.vy * oy;
    if (vn <= 0) return;
    s.vx -= (1 + COLLISION.WALL_RESTITUTION) * vn * ox;
    s.vy -= (1 + COLLISION.WALL_RESTITUTION) * vn * oy;
    const pen = clamp((COLLISION.WALL_FRICTION * vn) / CAR.MAX_SPEED, 0, COLLISION.WALL_MAX_PENALTY);
    s.vx *= 1 - pen;
    s.vy *= 1 - pen;
    if (vn > this.report.wallImpact) {
      this.report.wallImpact = vn;
      this.report.impactX = s.x + ox * CAR.RADIUS;
      this.report.impactY = s.y + oy * CAR.RADIUS;
    }
    // Glancing contact: ease the nose along the wall so the car slides cleanly.
    if (speedBefore > 1) {
      const glance = 1 - clamp(vn / speedBefore, 0, 1);
      if (glance > 0.35) {
        let tx = -oy;
        let ty = ox;
        if (tx * Math.cos(s.angle) + ty * Math.sin(s.angle) < 0) {
          tx = -tx;
          ty = -ty;
        }
        const wallAngle = Math.atan2(ty, tx);
        s.angle = wrapAngle(s.angle + angleDelta(s.angle, wallAngle) * COLLISION.WALL_ALIGN * glance);
      }
    }
  }

  private checkBoostPads(): void {
    const s = this.state;
    const pads = this.track.boostPads;
    let touching = -1;
    for (let k = 0; k < pads.length; k++) {
      const pad = pads[k];
      if (!pad) continue;
      const dx = s.x - pad.cx;
      const dy = s.y - pad.cy;
      if (dx * dx + dy * dy > 120 * 120) continue;
      const along = dx * pad.tx + dy * pad.ty;
      const lat = dx * pad.nx + dy * pad.ny;
      if (Math.abs(along) <= pad.halfLength && Math.abs(lat) <= pad.halfWidth + CAR.RADIUS * 0.5) {
        touching = k;
        break;
      }
    }
    if (touching >= 0 && touching !== s.onPad) {
      s.boostMs = CAR.BOOST_MS;
      const fx = Math.cos(s.angle);
      const fy = Math.sin(s.angle);
      const vf = s.vx * fx + s.vy * fy;
      if (vf < CAR.BOOST_MAX_SPEED) {
        const kick = Math.min(CAR.BOOST_KICK, CAR.BOOST_MAX_SPEED - Math.max(0, vf));
        s.vx += fx * kick;
        s.vy += fy * kick;
      }
      this.report.boostTriggered = true;
    }
    s.onPad = touching;
  }
}
