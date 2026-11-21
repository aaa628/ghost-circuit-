/**
 * Headless race simulation: car + obstacles + ordered checkpoints + 60s clock
 * + ghost recording, advanced one fixed 60 Hz tick at a time. The Phaser
 * scene, the autopilot and the tests all drive this same class, so what you
 * see on screen is exactly what gets validated.
 */
import { FIXED_DT, GHOST, MAX_TIME_MS, tickToMs } from '../config';
import { GhostRecorder } from '../ghost/GhostRecorder';
import { CarController, type CarInput, type StepReport } from '../physics/CarController';
import { ColliderPool, collectColliders } from '../track/Obstacles';
import { gateCrossing, unwrapProgress } from '../track/TrackQuery';
import type { Track } from '../track/TrackTypes';

export type RaceStatus = 'ready' | 'racing' | 'finished' | 'dnf';

export type TickEvents = {
  /** Index of the checkpoint crossed this tick, or -1. */
  checkpoint: number;
  checkpointTimeMs: number;
  finished: boolean;
  dnf: boolean;
  report: StepReport;
};

/** How far beyond the walls gate lines are extended when testing crossings. */
const GATE_EXTEND = 12;

export class RaceSim {
  readonly car: CarController;
  readonly colliders = new ColliderPool();
  readonly recorder = new GhostRecorder();
  status: RaceStatus = 'ready';
  tick = 0;
  nextCheckpoint = 0;
  finishTimeMs = 0;
  readonly checkpointTimes: number[] = [];
  /** Unwrapped lap progress in world units (starts slightly negative). */
  progress = 0;
  private readonly events: TickEvents;

  constructor(readonly track: Track) {
    this.car = new CarController(track);
    this.events = { checkpoint: -1, checkpointTimeMs: 0, finished: false, dnf: false, report: this.car.report };
    this.reset();
  }

  reset(): void {
    this.car.reset();
    this.recorder.reset();
    this.status = 'ready';
    this.tick = 0;
    this.nextCheckpoint = 0;
    this.finishTimeMs = 0;
    this.checkpointTimes.length = 0;
    this.progress = unwrapProgress(this.car.projection.s, 0, this.track.length);
    collectColliders(this.track.obstacles, 0, this.colliders);
    const s = this.car.state;
    this.recorder.sample(0, s.x, s.y, s.angle, false);
  }

  start(): void {
    if (this.status === 'ready') this.status = 'racing';
  }

  /** Race clock in ms (frozen at the exact finish time once finished). */
  get elapsedMs(): number {
    if (this.status === 'finished') return this.finishTimeMs;
    return Math.min(MAX_TIME_MS, tickToMs(this.tick));
  }

  get totalCheckpoints(): number {
    return this.track.checkpoints.length;
  }

  step(input: CarInput): TickEvents {
    const ev = this.events;
    ev.checkpoint = -1;
    ev.finished = false;
    ev.dnf = false;
    if (this.status !== 'racing') return ev;

    const s = this.car.state;
    const x0 = s.x;
    const y0 = s.y;
    // Obstacles are evaluated at the race time of the state being produced.
    collectColliders(this.track.obstacles, tickToMs(this.tick + 1), this.colliders);
    this.car.step(input, this.colliders);
    this.tick++;
    this.progress = unwrapProgress(this.car.projection.s, this.progress, this.track.length);

    const cps = this.track.checkpoints;
    if (this.nextCheckpoint < cps.length) {
      const gate = cps[this.nextCheckpoint];
      if (gate) {
        const u = gateCrossing(gate, x0, y0, s.x, s.y, GATE_EXTEND);
        if (u >= 0) {
          const t = tickToMs(this.tick - 1) + u * FIXED_DT;
          this.checkpointTimes.push(t);
          ev.checkpoint = this.nextCheckpoint;
          ev.checkpointTimeMs = t;
          this.nextCheckpoint++;
        }
      }
    } else {
      const u = gateCrossing(this.track.startLine, x0, y0, s.x, s.y, GATE_EXTEND);
      if (u >= 0) {
        const t = Math.min(MAX_TIME_MS, tickToMs(this.tick - 1) + u * FIXED_DT);
        const fx = x0 + (s.x - x0) * u;
        const fy = y0 + (s.y - y0) * u;
        this.recorder.finish(t, fx, fy, s.angle, s.boostMs > 0);
        this.finishTimeMs = Math.round(t);
        this.status = 'finished';
        ev.finished = true;
        return ev;
      }
    }

    if (this.tick % GHOST.SAMPLE_EVERY_TICKS === 0) {
      this.recorder.sample(tickToMs(this.tick), s.x, s.y, s.angle, s.boostMs > 0);
    }
    if (tickToMs(this.tick) >= MAX_TIME_MS) {
      this.status = 'dnf';
      ev.dnf = true;
    }
    return ev;
  }
}
