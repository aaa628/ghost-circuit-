/**
 * A deterministic autopilot that drives the real RaceSim.
 *
 * Used to (1) prove in tests that every generated circuit is completable well
 * inside 60s, (2) produce genuinely valid "pace" and offline-seed ghosts that
 * pass the same anti-cheat validation as human runs.
 *
 * It follows a lane plan (lateral offsets that dodge static hazards and pick a
 * split lane), predicts sliding-gate gaps, and limits speed with a curvature
 * braking profile.
 */
import { CAR, MAX_TICKS, TRACK } from '../config';
import { RaceSim } from '../race/RaceSim';
import { gateGapOffset } from '../track/Obstacles';
import type { Track } from '../track/TrackTypes';
import { angleDelta, clamp, smoothstep } from '../util/math';
import type { CarInput } from '../physics/CarController';

export type DriverSkill = {
  /** Fraction of the computed corner speed the driver dares to carry (0.7–1.0). */
  pace: number;
  /** Lateral apex-cutting aggressiveness (0–1). */
  apex: number;
  /** Prefer the shorter (inner) lane of split sections. */
  innerLane: boolean;
  /** Steering gain. */
  steerGain: number;
};

export const SKILLS: Record<'pace' | 'pro' | 'good' | 'casual' | 'rookie', DriverSkill> = {
  pace: { pace: 0.97, apex: 0.55, innerLane: false, steerGain: 2.8 },
  pro: { pace: 0.95, apex: 0.5, innerLane: true, steerGain: 2.7 },
  good: { pace: 0.9, apex: 0.4, innerLane: false, steerGain: 2.5 },
  casual: { pace: 0.83, apex: 0.25, innerLane: true, steerGain: 2.3 },
  rookie: { pace: 0.76, apex: 0.1, innerLane: false, steerGain: 2.1 },
};

type GateRef = { s: number; amplitude: number; omega: number; phase: number };

export class Autopilot {
  private readonly lane: Float64Array;
  /** Lane "lock" weight: 1 where a hazard dictates the line. */
  private readonly locked: Float64Array;
  private readonly speedLimit: Float64Array;
  private readonly gates: GateRef[] = [];
  readonly input: CarInput = { throttle: 0, brake: 0, steer: 0, drift: false };

  constructor(private readonly track: Track, private readonly skill: DriverSkill) {
    const n = track.n;
    this.lane = new Float64Array(n);
    this.locked = new Float64Array(n);
    this.speedLimit = new Float64Array(n);
    this.buildLanePlan();
    this.buildSpeedProfile();
  }

  private idx(s: number): number {
    const L = this.track.length;
    let w = s % L;
    if (w < 0) w += L;
    return Math.round(w / this.track.step) % this.track.n;
  }

  private lock(s0: number, s1: number, lateral: number, fade = 60): void {
    for (let s = s0 - fade; s <= s1 + fade; s += this.track.step) {
      const i = this.idx(s);
      const w = Math.min(smoothstep(s0 - fade, s0, s), 1 - smoothstep(s1, s1 + fade, s));
      if (w >= (this.locked[i] as number)) {
        this.locked[i] = w;
        this.lane[i] = lateral;
      }
    }
  }

  private buildLanePlan(): void {
    const t = this.track;
    const n = t.n;
    // Base racing line: drift toward the inside of upcoming curvature.
    const look = Math.round(160 / t.step);
    for (let i = 0; i < n; i++) {
      let k = 0;
      for (let j = 0; j < look; j++) k += t.curvature[(i + j) % n] as number;
      k /= look;
      const hw = t.hw[i] as number;
      this.lane[i] = clamp(k * 9000, -1, 1) * hw * 0.5 * this.skill.apex;
    }
    for (const o of t.obstacles) {
      switch (o.type) {
        case 'island': {
          const zone = t.zones.find((z) => z.kind === 'split' && z.sStart <= o.sStart && z.sEnd >= o.sEnd);
          const inner = zone?.innerSide ?? 1;
          const side = this.skill.innerLane ? inner : -inner;
          const wide = TRACK.HALF_WIDTH * TRACK.WIDE_MULT;
          const lat = side * (o.r + (wide - o.r) * (this.skill.innerLane ? 0.72 : 0.5));
          this.lock(o.sStart - 40, o.sEnd + 20, lat, 110);
          break;
        }
        case 'fin': {
          const hw = t.hw[this.idx(o.s)] as number;
          this.lock(o.s - 45, o.s + 25, -o.side * hw * 0.52, 55);
          break;
        }
        case 'sweeper': {
          const hw = t.hw[this.idx(o.s)] as number;
          const side = this.skill.apex > 0.45 ? 1 : -1;
          this.lock(o.s - 70, o.s + 70, side * (hw - CAR.RADIUS - 8), 90);
          break;
        }
        case 'pulsar': {
          const hw = t.hw[this.idx(o.s)] as number;
          if (Math.abs(o.lateral) > hw * 0.6) {
            this.lock(o.s - 80, o.s + 60, -o.side * hw * 0.55, 80);
          }
          break;
        }
        case 'gate':
          this.gates.push({ s: o.s, amplitude: o.amplitude, omega: o.omega, phase: o.phase });
          break;
      }
    }
  }

  private buildSpeedProfile(): void {
    const t = this.track;
    const n = t.n;
    const lim = this.speedLimit;
    const maxTurn = CAR.TURN_RATE * (1 - CAR.TURN_HIGH_SPEED_FALLOFF * 0.85);
    for (let i = 0; i < n; i++) {
      let k = 0;
      for (let j = -2; j <= 2; j++) k = Math.max(k, Math.abs(t.curvature[(i + j + n) % n] as number));
      const radius = k > 1e-6 ? 1 / k : 1e6;
      lim[i] = Math.min(CAR.MAX_SPEED, radius * maxTurn * 0.92 * this.skill.pace);
    }
    // Hazard zones: approach gates and fins at sane speeds.
    for (const o of t.obstacles) {
      if (o.type === 'gate' || o.type === 'fin') {
        const cap = o.type === 'gate' ? 330 : 300;
        for (let s = o.s - 60; s <= o.s + 30; s += t.step) {
          const i = this.idx(s);
          lim[i] = Math.min(lim[i] as number, cap * this.skill.pace);
        }
      }
    }
    // Backward braking passes (twice around the loop for wrap-around).
    const brake = CAR.BRAKE * 0.55;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = n - 1; i >= 0; i--) {
        const next = lim[(i + 1) % n] as number;
        const allowed = Math.sqrt(next * next + 2 * brake * t.step);
        if ((lim[i] as number) > allowed) lim[i] = allowed;
      }
    }
  }

  /** Compute input for the sim's current state. */
  drive(sim: RaceSim): CarInput {
    const t = this.track;
    const st = sim.car.state;
    const proj = sim.car.projection;
    const speed = Math.max(0, st.forwardSpeed);
    const lookahead = 55 + speed * 0.26;
    const sTarget = proj.s + lookahead;
    const it = this.idx(sTarget);
    let lateral = this.lane[it] as number;

    // Sliding gate: aim for where the gap will be when we arrive.
    for (const g of this.gates) {
      let ds = g.s - proj.s;
      if (ds < -t.length / 2) ds += t.length;
      if (ds > -20 && ds < 260) {
        const eta = sim.elapsedMs + (Math.max(0, ds) / Math.max(150, speed)) * 1000;
        const gap = gateGapOffset(g.amplitude, g.omega, g.phase, eta);
        const w = 1 - smoothstep(200, 260, ds);
        lateral = lateral * (1 - w) + gap * w;
      }
    }

    const hw = t.hw[it] as number;
    lateral = clamp(lateral, -(hw - CAR.RADIUS - 4), hw - CAR.RADIUS - 4);
    const tx = (t.xs[it] as number) + (t.nx[it] as number) * lateral;
    const ty = (t.ys[it] as number) + (t.ny[it] as number) * lateral;
    const desired = Math.atan2(ty - st.y, tx - st.x);
    const err = angleDelta(st.angle, desired);

    const input = this.input;
    input.steer = clamp(err * this.skill.steerGain, -1, 1);

    // Speed control: the tightest limit over the next stretch.
    const here = this.idx(proj.s);
    let limit = Number.POSITIVE_INFINITY;
    for (let k = 0; k <= 12; k++) limit = Math.min(limit, this.speedLimit[(here + k) % t.n] as number);
    if (Math.abs(err) > 0.9) limit = Math.min(limit, 220);
    input.throttle = speed < limit ? 1 : 0;
    input.brake = speed > limit + 30 ? 1 : 0;
    input.drift = Math.abs(err) > 0.42 && speed > 250;
    if (st.forwardSpeed < -20) {
      input.throttle = 1;
      input.brake = 0;
    }
    return input;
  }
}

export type AutopilotResult = {
  finished: boolean;
  timeMs: number;
  ghostData: string;
  sim: RaceSim;
};

/** Drive a full lap with the autopilot. Deterministic for a given track + skill. */
export function runAutopilot(track: Track, skill: DriverSkill): AutopilotResult {
  const sim = new RaceSim(track);
  const pilot = new Autopilot(track, skill);
  sim.start();
  for (let i = 0; i < MAX_TICKS + 2 && sim.status === 'racing'; i++) {
    sim.step(pilot.drive(sim));
  }
  const finished = sim.status === 'finished';
  return {
    finished,
    timeMs: finished ? sim.finishTimeMs : 0,
    ghostData: finished ? sim.recorder.encode() : '',
    sim,
  };
}
