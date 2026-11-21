/**
 * RaceScene — the only Phaser scene. Orchestrates:
 *   • a fixed 60 Hz accumulator stepping RaceSim (physics, checkpoints, clock)
 *     decoupled from the display refresh rate, with render interpolation
 *   • track / hazard rendering, the four ghost slots, player car + particles
 *   • look-ahead camera with speed zoom and impact shake
 *   • audio cues and HUD frame data (via hooks)
 *
 * Instant retry never reloads the scene: restart() resets the sim, ghosts,
 * hazards (pure functions of race time) and effects in place.
 */
import Phaser from 'phaser';
import {
  CAMERA,
  CAR,
  COLLISION,
  COLORS,
  FIXED_DT,
  GHOST_SLOTS,
  MAX_FRAME_DELTA_MS,
  MAX_TIME_MS,
  tickToMs,
  type GhostSlot,
} from '../config';
import { Autopilot, SKILLS } from '../ai/Autopilot';
import type { SynthAudio } from '../audio/SynthAudio';
import { GhostPlayer } from '../ghost/GhostPlayer';
import type { GhostTimeline } from '../ghost/GhostTimeline';
import type { InputController } from '../input/InputController';
import type { CarInput } from '../physics/CarController';
import { RaceSim, type RaceStatus, type TickEvents } from '../race/RaceSim';
import { ObstacleRenderer } from '../render/ObstacleRenderer';
import { CAR_ORIGIN, CAR_DISPLAY_SCALE, GHOST_PALETTE, PLAYER_PALETTE, carFrameFor, ensureCarAtlas } from '../render/CarModel';
import { TEX, ensureTextures } from '../render/Textures';

export const CAR_ATLAS = 'gc-car-3d';
export const GHOST_ATLAS = 'gc-ghost-3d';
import { TrackRenderer } from '../render/TrackRenderer';
import type { Track } from '../track/TrackTypes';
import { clamp, lerp, lerpAngle } from '../util/math';

export type StartMode = 'instant' | 'countdown';

export type GhostDot = { slot: GhostSlot; x: number; y: number };

export type FrameInfo = {
  status: RaceStatus;
  countdown: number | null;
  elapsedMs: number;
  checkpointsCleared: number;
  checkpointTotal: number;
  speed: number;
  boosting: boolean;
  deltaPb: number | null;
  deltaTarget: number | null;
  targetSlot: GhostSlot | null;
  carX: number;
  carY: number;
  ghosts: GhostDot[];
};

export type RunResult = {
  status: 'finished' | 'dnf';
  timeMs: number;
  ghostData: string | null;
  checkpointsCleared: number;
  checkpointTimes: number[];
  dateKey: string;
};

export type SceneHooks = {
  onReady: (scene: RaceScene) => void;
  onFrame: (info: FrameInfo) => void;
  onStart: () => void;
  onCheckpoint: (index: number, timeMs: number, deltaPb: number | null, deltaTarget: number | null) => void;
  onFinish: (result: RunResult) => void;
  onRestart: () => void;
};

const COUNTDOWN_STEP_MS = 650;
const TARGET_PRIORITY: readonly GhostSlot[] = ['challenger', 'champ', 'record'];

export class RaceScene extends Phaser.Scene {
  private track: Track;
  private sim: RaceSim;
  private trackView: TrackRenderer | null = null;
  private obstacleView: ObstacleRenderer | null = null;
  private readonly ghostPlayers = new Map<GhostSlot, GhostPlayer>();
  private car: Phaser.GameObjects.Image | null = null;
  private boostFx: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private sparks: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private driftFx: Phaser.GameObjects.Particles.ParticleEmitter | null = null;

  private acc = 0;
  private prevX = 0;
  private prevY = 0;
  private prevA = 0;
  private camX = 0;
  private camY = 0;
  private camZoom = 1;
  private wallMs = 0;
  private postRunMs = 0;
  private wantStart = false;
  private countdownLeft = -1;
  private lastCountdownStep = -1;
  private startMode: StartMode = 'instant';
  private lastInput: CarInput = { throttle: 0, brake: 0, steer: 0, drift: false };
  private deltaClock = 0;
  private cachedDeltaPb: number | null = null;
  private cachedDeltaTarget: number | null = null;
  private readonly disposers: Array<() => void> = [];
  private readonly frame: FrameInfo;
  private readonly viewRect = new Phaser.Geom.Rectangle();
  private isReady = false;
  /** Attract/demo mode: the autopilot drives the player's car. */
  private pilot: Autopilot | null = null;
  private pilotEnabled = false;

  constructor(
    private readonly hooks: SceneHooks,
    private readonly controls: InputController,
    private readonly sfx: SynthAudio,
    initialTrack: Track,
  ) {
    super({ key: 'race' });
    this.track = initialTrack;
    this.sim = new RaceSim(initialTrack);
    this.frame = {
      status: 'ready', countdown: null, elapsedMs: 0, checkpointsCleared: 0,
      checkpointTotal: initialTrack.checkpoints.length, speed: 0, boosting: false,
      deltaPb: null, deltaTarget: null, targetSlot: null, carX: 0, carY: 0, ghosts: [],
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  create(): void {
    ensureTextures(this);
    ensureCarAtlas(this, CAR_ATLAS, PLAYER_PALETTE, true);
    ensureCarAtlas(this, GHOST_ATLAS, GHOST_PALETTE, false);
    this.cameras.main.setBackgroundColor(COLORS.background);

    for (const slot of GHOST_SLOTS) this.ghostPlayers.set(slot, new GhostPlayer(this, slot));

    this.car = this.add
      .image(0, 0, CAR_ATLAS, 0)
      .setOrigin(CAR_ORIGIN.x, CAR_ORIGIN.y)
      .setScale(CAR_DISPLAY_SCALE)
      .setDepth(11);

    // Flat particles, normal blending: white boost puffs, grey tyre smoke, debris.
    this.boostFx = this.add
      .particles(0, 0, TEX.dot, {
        lifespan: { min: 220, max: 400 },
        speed: { min: 20, max: 80 },
        scale: { start: 0.35, end: 0 },
        alpha: { start: 0.9, end: 0 },
        tint: [COLORS.white],
        emitting: false,
      })
      .setDepth(10);
    this.driftFx = this.add
      .particles(0, 0, TEX.dot, {
        lifespan: { min: 300, max: 600 },
        speed: { min: 10, max: 40 },
        scale: { start: 0.3, end: 0.7 },
        alpha: { start: 0.35, end: 0 },
        tint: [COLORS.smoke],
        emitting: false,
      })
      .setDepth(9.5);
    this.sparks = this.add
      .particles(0, 0, TEX.dot, {
        lifespan: { min: 200, max: 450 },
        speed: { min: 80, max: 260 },
        scale: { start: 0.2, end: 0 },
        alpha: { start: 1, end: 0 },
        tint: [COLORS.white, COLORS.burgundyHi],
        emitting: false,
      })
      .setDepth(10);

    this.buildTrackViews();

    const onResize = (): void => this.snapCamera();
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.disposers.push(() => this.scale.off(Phaser.Scale.Events.RESIZE, onResize));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.cleanup());

    this.restart(false);
    this.isReady = true;
    this.hooks.onReady(this);
  }

  private buildTrackViews(): void {
    this.trackView?.destroy();
    this.obstacleView?.destroy();
    this.trackView = new TrackRenderer(this, this.track);
    this.obstacleView = new ObstacleRenderer(this, this.track.obstacles);
  }

  private cleanup(): void {
    for (const d of this.disposers.splice(0)) d();
    this.trackView?.destroy();
    this.obstacleView?.destroy();
    this.trackView = null;
    this.obstacleView = null;
    for (const g of this.ghostPlayers.values()) g.destroy();
    this.ghostPlayers.clear();
    this.sfx.engineStop();
    this.isReady = false;
  }

  // ── Public API (used by GameApp) ─────────────────────────────────────────

  get currentTrack(): Track {
    return this.track;
  }

  get status(): RaceStatus {
    return this.sim.status;
  }

  /** Swap to another circuit (e.g. yesterday's) without restarting the scene. */
  loadTrack(track: Track): void {
    this.track = track;
    this.sim = new RaceSim(track);
    this.pilot = this.pilotEnabled ? new Autopilot(track, SKILLS.pro) : null;
    this.frame.checkpointTotal = track.checkpoints.length;
    for (const g of this.ghostPlayers.values()) g.set(null, '');
    if (this.isReady) {
      this.buildTrackViews();
      this.restart(true);
    }
  }

  setGhost(slot: GhostSlot, timeline: GhostTimeline | null, label: string): void {
    this.ghostPlayers.get(slot)?.set(timeline, label);
    this.cachedDeltaPb = null;
    this.cachedDeltaTarget = null;
  }

  setGhostVisible(slot: GhostSlot, visible: boolean): void {
    this.ghostPlayers.get(slot)?.setVisible(visible);
  }

  hasGhost(slot: GhostSlot): boolean {
    return this.ghostPlayers.get(slot)?.active ?? false;
  }

  /** Let the autopilot drive the player's car (demo footage, automated tests). */
  setAutopilot(enabled: boolean): void {
    this.pilotEnabled = enabled;
    this.pilot = enabled ? new Autopilot(this.track, SKILLS.pro) : null;
  }

  get autopilot(): boolean {
    return this.pilotEnabled;
  }

  setStartMode(mode: StartMode): void {
    this.startMode = mode;
  }

  /** First movement input: instant start (or kick off the countdown). */
  requestStart(): void {
    this.sfx.unlock();
    if (this.sim.status !== 'ready') return;
    if (this.startMode === 'instant') this.wantStart = true;
    else if (this.countdownLeft < 0) {
      this.countdownLeft = COUNTDOWN_STEP_MS * 3;
      this.lastCountdownStep = -1;
    }
  }

  /** Instant retry: everything back to 0.000s in-place (no scene reload). */
  restart(notify = true): void {
    this.sim.reset();
    this.acc = 0;
    this.postRunMs = 0;
    this.wantStart = false;
    this.countdownLeft = -1;
    this.lastCountdownStep = -1;
    this.cachedDeltaPb = null;
    this.cachedDeltaTarget = null;
    const s = this.sim.car.state;
    this.prevX = s.x;
    this.prevY = s.y;
    this.prevA = s.angle;
    this.trackView?.setCheckpointState(0);
    this.boostFx?.killAll();
    this.driftFx?.killAll();
    this.sparks?.killAll();
    this.cameras.main?.resetFX();
    this.sfx.engineStop();
    this.snapCamera();
    if (notify) this.hooks.onRestart();
  }

  // ── Frame loop ────────────────────────────────────────────────────────────

  override update(_time: number, rawDelta: number): void {
    const delta = Math.min(rawDelta, MAX_FRAME_DELTA_MS);
    this.wallMs += delta;
    const sim = this.sim;

    if (sim.status === 'ready') {
      if (this.countdownLeft >= 0) {
        this.countdownLeft -= delta;
        const step = Math.ceil(this.countdownLeft / COUNTDOWN_STEP_MS);
        if (step !== this.lastCountdownStep) {
          this.lastCountdownStep = step;
          this.sfx.tick(step <= 0);
        }
        if (this.countdownLeft <= 0) this.begin();
      } else if (this.wantStart) {
        this.begin();
      }
    }

    if (sim.status === 'racing') {
      this.acc += delta;
      while (this.acc >= FIXED_DT && sim.status === 'racing') {
        const s = sim.car.state;
        this.prevX = s.x;
        this.prevY = s.y;
        this.prevA = s.angle;
        const input = this.pilot ? this.pilot.drive(sim) : this.controls.read();
        this.lastInput = input;
        const ev = sim.step(input);
        this.handleTick(ev);
        this.acc -= FIXED_DT;
      }
      if (sim.status !== 'racing') this.acc = 0;
    } else if (sim.status === 'finished' || sim.status === 'dnf') {
      this.postRunMs += delta;
    }

    this.renderFrame(delta);
  }

  private begin(): void {
    this.countdownLeft = -1;
    this.wantStart = false;
    this.sim.start();
    this.sfx.unlock();
    this.sfx.engineStart();
    this.hooks.onStart();
  }

  private handleTick(ev: TickEvents): void {
    const r = ev.report;
    const s = this.sim.car.state;
    if (r.wallImpact > COLLISION.IMPACT_FX_THRESHOLD) {
      const k = clamp(r.wallImpact / CAR.MAX_SPEED, 0, 1);
      this.sfx.thud(k);
      this.sparks?.explode(Math.round(6 + 14 * k), r.impactX, r.impactY);
      this.cameras.main.shake(120 + 120 * k, 0.003 + 0.007 * k);
    }
    if (r.obstacleImpact > COLLISION.IMPACT_FX_THRESHOLD * 0.6) {
      const k = clamp(r.obstacleImpact / CAR.MAX_SPEED, 0, 1);
      this.sfx.thud(k);
      if (r.hazardHit) this.sfx.zap();
      this.sparks?.explode(Math.round(8 + 16 * k), r.impactX, r.impactY);
      this.cameras.main.shake(140, 0.004 + 0.008 * k);
    }
    if (r.boostTriggered) {
      this.sfx.boost();
      this.boostFx?.explode(26, s.x, s.y);
    }
    if (ev.checkpoint >= 0) {
      this.sfx.checkpoint();
      this.trackView?.setCheckpointState(this.sim.nextCheckpoint);
      this.updateDeltas(true);
      this.hooks.onCheckpoint(ev.checkpoint, ev.checkpointTimeMs, this.cachedDeltaPb, this.cachedDeltaTarget);
    }
    if (ev.finished || ev.dnf) {
      this.sfx.engineStop();
      if (ev.dnf) this.sfx.dnf();
      else this.sfx.finish();
      this.trackView?.setCheckpointState(this.sim.nextCheckpoint);
      this.hooks.onFinish({
        status: ev.finished ? 'finished' : 'dnf',
        timeMs: ev.finished ? this.sim.finishTimeMs : MAX_TIME_MS,
        ghostData: ev.finished ? this.sim.recorder.encode() : null,
        checkpointsCleared: this.sim.nextCheckpoint,
        checkpointTimes: this.sim.checkpointTimes.slice(),
        dateKey: this.track.dateKey,
      });
    }
  }

  private targetSlot(): GhostSlot | null {
    for (const slot of TARGET_PRIORITY) {
      const g = this.ghostPlayers.get(slot);
      if (g?.active) return slot;
    }
    return null;
  }

  private updateDeltas(force: boolean): void {
    if (!force && this.wallMs - this.deltaClock < 100) return;
    this.deltaClock = this.wallMs;
    const sim = this.sim;
    if (sim.status === 'ready' || sim.progress < 40) {
      this.cachedDeltaPb = null;
      this.cachedDeltaTarget = null;
      return;
    }
    const t = sim.elapsedMs;
    const p = Math.min(sim.progress, this.track.length);
    const pb = this.ghostPlayers.get('pb');
    this.cachedDeltaPb = pb?.timeline ? t - pb.timeline.timeAtProgress(p) : null;
    const slot = this.targetSlot();
    const tg = slot ? this.ghostPlayers.get(slot) : undefined;
    this.cachedDeltaTarget = tg?.timeline ? t - tg.timeline.timeAtProgress(p) : null;
  }

  private visualTimeMs(alpha: number): number {
    const sim = this.sim;
    switch (sim.status) {
      case 'ready':
        return 0;
      case 'racing':
        return Math.max(0, tickToMs(sim.tick - 1) + alpha * FIXED_DT);
      case 'finished':
        return Math.min(MAX_TIME_MS, sim.finishTimeMs + this.postRunMs);
      case 'dnf':
        return MAX_TIME_MS;
    }
  }

  private renderFrame(delta: number): void {
    const sim = this.sim;
    const s = sim.car.state;
    const racing = sim.status === 'racing';
    const alpha = racing ? clamp(this.acc / FIXED_DT, 0, 1) : 1;
    const x = lerp(this.prevX, s.x, alpha);
    const y = lerp(this.prevY, s.y, alpha);
    const a = lerpAngle(this.prevA, s.angle, alpha);
    const visualMs = this.visualTimeMs(alpha);
    const boosting = s.boostMs > 0;

    this.car?.setPosition(x, y).setFrame(carFrameFor(a));

    // Effects.
    const fx = Math.cos(a);
    const fy = Math.sin(a);
    const rearX = x - fx * 18;
    const rearY = y - fy * 18;
    if (racing) {
      if (boosting) this.boostFx?.emitParticleAt(rearX, rearY, 1);
      if (s.drifting && Math.abs(s.lateralSpeed) > 70 && s.speed > 180) {
        this.driftFx?.emitParticleAt(rearX - fy * 8, rearY + fx * 8, 1);
        this.driftFx?.emitParticleAt(rearX + fy * 8, rearY - fx * 8, 1);
      }
      this.sfx.engineUpdate(s.speed / CAR.MAX_SPEED, this.lastInput.throttle, boosting);
    }

    // Camera.
    this.updateCamera(delta, x, y, s.vx, s.vy, s.speed);
    const cam = this.cameras.main;
    this.viewRect.setTo(cam.worldView.x, cam.worldView.y, cam.worldView.width, cam.worldView.height);

    // Hazards, track animation, ghosts.
    this.obstacleView?.draw(visualMs, this.wallMs, this.viewRect);
    this.trackView?.update(visualMs, this.wallMs);
    const ghosts: GhostDot[] = this.frame.ghosts;
    ghosts.length = 0;
    for (const g of this.ghostPlayers.values()) {
      if (!g.shown) continue;
      g.update(visualMs, this.camZoom);
      ghosts.push({ slot: g.slot, x: g.x, y: g.y });
    }

    // HUD frame data.
    this.updateDeltas(false);
    const f = this.frame;
    f.status = sim.status;
    f.countdown = this.countdownLeft >= 0 ? Math.max(0, Math.ceil(this.countdownLeft / COUNTDOWN_STEP_MS)) : null;
    f.elapsedMs = racing ? Math.min(MAX_TIME_MS, visualMs) : sim.elapsedMs;
    f.checkpointsCleared = sim.nextCheckpoint;
    f.speed = s.speed;
    f.boosting = boosting;
    f.deltaPb = this.cachedDeltaPb;
    f.deltaTarget = this.cachedDeltaTarget;
    f.targetSlot = this.targetSlot();
    f.carX = x;
    f.carY = y;
    this.hooks.onFrame(f);
  }

  private baseZoom(): number {
    const w = this.scale.width || 800;
    const h = this.scale.height || 600;
    const span = Math.min(w, h * 1.25);
    return clamp(span / CAMERA.VIEW_SPAN, CAMERA.MIN_ZOOM, CAMERA.MAX_ZOOM);
  }

  private updateCamera(delta: number, x: number, y: number, vx: number, vy: number, speed: number): void {
    const dt = delta / 1000;
    const k = 1 - Math.exp(-CAMERA.FOLLOW_RATE * dt);
    let lx = vx * CAMERA.LOOK_AHEAD_S;
    let ly = vy * CAMERA.LOOK_AHEAD_S;
    const ll = Math.sqrt(lx * lx + ly * ly);
    if (ll > CAMERA.LOOK_AHEAD_MAX) {
      lx *= CAMERA.LOOK_AHEAD_MAX / ll;
      ly *= CAMERA.LOOK_AHEAD_MAX / ll;
    }
    this.camX += (x + lx - this.camX) * k;
    this.camY += (y + ly - this.camY) * k;
    const target = this.baseZoom() * (1 - CAMERA.SPEED_ZOOM_OUT * clamp(speed / CAR.MAX_SPEED, 0, 1.4));
    this.camZoom += (target - this.camZoom) * (1 - Math.exp(-3 * dt));
    const cam = this.cameras.main;
    cam.setZoom(this.camZoom);
    cam.centerOn(this.camX, this.camY);
  }

  private snapCamera(): void {
    const s = this.sim.car.state;
    this.camX = s.x;
    this.camY = s.y;
    this.camZoom = this.baseZoom();
    const cam = this.cameras.main;
    if (!cam) return;
    cam.setZoom(this.camZoom);
    cam.centerOn(this.camX, this.camY);
  }
}
