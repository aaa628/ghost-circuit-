/**
 * Ghost Circuit — global configuration.
 *
 * Everything in this file is pure data (no runtime Phaser import) so the same
 * constants drive the browser game, the autopilot, the unit tests and the
 * server-side anti-cheat validator. The Phaser game config is produced by
 * `createPhaserConfig`, which receives the Phaser namespace by injection.
 */
import type PhaserType from 'phaser';

// ─── Time & simulation ──────────────────────────────────────────────────────
/** Physics ticks per second. Every device simulates at exactly this rate. */
export const TICK_RATE = 60;
/** Fixed physics timestep in milliseconds (16.666…ms). */
export const FIXED_DT = 1000 / TICK_RATE;
/** Fixed physics timestep in seconds. */
export const FIXED_DT_S = 1 / TICK_RATE;
/** Hard limit for one attempt: 60.000 seconds. */
export const MAX_TIME_MS = 60_000;
/** Max ticks a run can last (60s × 60Hz). */
export const MAX_TICKS = (MAX_TIME_MS * TICK_RATE) / 1000;
/** Clamp for the frame accumulator so a background tab can't spiral. */
export const MAX_FRAME_DELTA_MS = 250;
/** Race-clock milliseconds for a given tick (exact for integer ticks). */
export const tickToMs = (tick: number): number => (tick * 1000) / TICK_RATE;

// ─── Car & handling ─────────────────────────────────────────────────────────
export const CAR = {
  /** Collision radius in world units (the car is drawn as a 34×18 body). */
  RADIUS: 11,
  LENGTH: 34,
  WIDTH: 18,
  /** Top speed on throttle, units/s. */
  MAX_SPEED: 540,
  /** Top speed while a boost is active, units/s. */
  BOOST_MAX_SPEED: 760,
  /** Absolute physical speed cap (anti-cheat bound uses this). */
  HARD_SPEED_CAP: 780,
  ACCEL: 860,
  BOOST_ACCEL_MULT: 1.9,
  BRAKE: 1500,
  REVERSE_ACCEL: 620,
  REVERSE_MAX: 210,
  /** Exponential drag when coasting, 1/s. */
  COAST_DRAG: 1.1,
  /** Always-on rolling drag, 1/s. */
  ROLL_DRAG: 0.12,
  /** How fast over-speed (after a boost) decays back to MAX_SPEED, 1/s. */
  OVERSPEED_DECAY: 1.6,
  /** Heading turn rate at reference speed, rad/s. */
  TURN_RATE: 3.45,
  /** Below this forward speed, steering authority fades out. */
  TURN_SPEED_REF: 170,
  /** Fraction of turn authority lost at top speed. */
  TURN_HIGH_SPEED_FALLOFF: 0.3,
  /** Steering input slew rate, 1/s (0→full lock in ~0.11s). */
  STEER_RATE: 9,
  /** Lateral grip, 1/s (higher = less sideways slide). */
  GRIP: 9.5,
  /** Lateral grip while drifting, 1/s. */
  DRIFT_GRIP: 1.9,
  /** Turn-rate multiplier while drifting. */
  DRIFT_TURN_MULT: 1.5,
  /** Extra drag while drifting, 1/s. */
  DRIFT_DRAG: 0.18,
  /** Minimum forward speed for drift to engage. */
  DRIFT_MIN_SPEED: 140,
  /** Share of lateral slip that grip converts back into forward speed. */
  SLIP_REDIRECT: 0.55,
  /** Boost duration after touching a pad, ms. */
  BOOST_MS: 1100,
  /** Instant forward kick when hitting a pad, units/s. */
  BOOST_KICK: 140,
} as const;

// ─── Collisions ─────────────────────────────────────────────────────────────
export const COLLISION = {
  WALL_RESTITUTION: 0.22,
  /** Proportional speed penalty per unit of normal impact speed / MAX_SPEED. */
  WALL_FRICTION: 0.85,
  WALL_MAX_PENALTY: 0.55,
  /** How strongly a glancing wall contact aligns the car with the wall. */
  WALL_ALIGN: 0.18,
  OBSTACLE_RESTITUTION: 0.55,
  OBSTACLE_FRICTION: 0.7,
  OBSTACLE_MAX_PENALTY: 0.5,
  /** Impact speed above which the camera shakes and the thud plays. */
  IMPACT_FX_THRESHOLD: 90,
} as const;

// ─── Track geometry ─────────────────────────────────────────────────────────
export const TRACK = {
  /** Resample spacing for the centerline polyline, world units. */
  STEP: 10,
  HALF_WIDTH: 74,
  NARROW_MULT: 0.78,
  WIDE_MULT: 1.85,
  ARENA_MULT: 1.3,
  /** Minimum clear space between the walls of unrelated track sections. */
  WALL_GAP: 84,
  /** Minimum centerline radius as a multiple of the local half-width. */
  MIN_RADIUS_MULT: 1.7,
  MIN_LENGTH: 6800,
  MAX_LENGTH: 13200,
  /** The car spawns this far behind the start/finish line. */
  SPAWN_BACK: 46,
  /** Obstacle-free distance after the line and before it. */
  START_CLEAR_AFTER: 430,
  START_CLEAR_BEFORE: 260,
  /** Hazards must leave at least this much open width at all times. */
  MIN_PASSAGE: 34,
} as const;

// ─── Ghosts ─────────────────────────────────────────────────────────────────
export const GHOST = {
  /** Sample every N physics ticks (2 → 30 Hz). */
  SAMPLE_EVERY_TICKS: 2,
  /** Position quantization: 0.1 world units. */
  POS_SCALE: 10,
  /** Rotation quantization: 0.01 rad. */
  ROT_SCALE: 100,
  MAX_FRAMES: 1900,
  /** Max ghostData string length accepted by the API (bytes, base64url). */
  MAX_ENCODED_LENGTH: 24_000,
  TRAIL_FRAMES: 14,
  ALPHA: 0.5,
} as const;

/** Ghost roster slots and their visual identity. */
export type GhostSlot = 'pb' | 'record' | 'champ' | 'challenger';
export const GHOST_SLOTS: readonly GhostSlot[] = ['pb', 'record', 'champ', 'challenger'];
export const GHOST_STYLE: Record<GhostSlot, { color: number; css: string; label: string; short: string }> = {
  pb: { color: 0xffffff, css: '#ffffff', label: 'PB', short: 'PB' },
  record: { color: 0xc8264b, css: '#c8264b', label: '#1', short: '#1' },
  champ: { color: 0x9a9a9a, css: '#9a9a9a', label: "YESTERDAY'S CHAMP", short: 'CHAMP' },
  challenger: { color: 0xf0b3c0, css: '#f0b3c0', label: 'CHALLENGER', short: 'RIVAL' },
};

// ─── Palette (black · burgundy #6D001A · white) ──────────────────────────────
export const COLORS = {
  background: 0x0a0a0a,
  grid: 0x121212,
  gridMajor: 0x181818,
  shoulder: 0x141414,
  road: 0x1e1e1e,
  roadLine: 0x2b2b2b,
  burgundy: 0x6d001a,
  burgundyHi: 0x9e1030,
  white: 0xffffff,
  /** Alternating curb / minimap sector colors. */
  sector: [0xffffff, 0x9e1030] as const,
  hazard: 0x6d001a,
  hazardEdge: 0xffffff,
  checkpoint: 0xffffff,
  smoke: 0x7a7a7a,
} as const;

// ─── Camera ─────────────────────────────────────────────────────────────────
export const CAMERA = {
  /** World units that should fit across the shorter screen dimension. */
  VIEW_SPAN: 660,
  MIN_ZOOM: 0.45,
  MAX_ZOOM: 1.6,
  LOOK_AHEAD_S: 0.32,
  LOOK_AHEAD_MAX: 210,
  FOLLOW_RATE: 7.5,
  SPEED_ZOOM_OUT: 0.12,
} as const;

/** Day #1 of Ghost Circuit (used for the "Circuit #N" label). */
export const LAUNCH_DATE_KEY = '2026-11-11';

/** Runs submitted this long after UTC midnight may still count for the previous day. */
export const SUBMIT_GRACE_MS = 5 * 60 * 1000;

/**
 * Build the Phaser game config. Phaser is injected so this module stays free
 * of runtime Phaser imports (the server imports the constants above).
 */
export function createPhaserConfig(
  P: typeof PhaserType,
  parent: HTMLElement,
  scenes: PhaserType.Types.Scenes.SceneType[],
): PhaserType.Types.Core.GameConfig {
  return {
    type: P.AUTO,
    parent,
    backgroundColor: '#0a0a0a',
    antialias: true,
    roundPixels: false,
    disableContextMenu: true,
    banner: false,
    scale: {
      mode: P.Scale.RESIZE,
      autoCenter: P.Scale.NO_CENTER,
      width: parent.clientWidth || window.innerWidth,
      height: parent.clientHeight || window.innerHeight,
    },
    render: {
      powerPreference: 'high-performance',
      antialias: true,
    },
    fps: { smoothStep: false },
    input: { keyboard: true, touch: true, mouse: true, gamepad: false },
    audio: { noAudio: true },
    scene: scenes,
  };
}
