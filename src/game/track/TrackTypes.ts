/** Data model for a generated daily circuit. Plain data — safe for server use. */

export type ArchetypeId = 'grandprix' | 'hairpin' | 'technical' | 'speedway' | 'serpent';

/** A line across the track. Crossing it in the forward direction counts. */
export type Gate = {
  /** Centerline sample index of the gate. */
  index: number;
  /** Arc length position. */
  s: number;
  cx: number;
  cy: number;
  /** Endpoints slightly beyond each wall. */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Forward (travel) direction. */
  tx: number;
  ty: number;
  halfWidth: number;
};

export type BoostPad = {
  s: number;
  cx: number;
  cy: number;
  /** Unit forward direction. */
  tx: number;
  ty: number;
  /** Unit lateral direction (track normal). */
  nx: number;
  ny: number;
  halfLength: number;
  halfWidth: number;
  /** Lateral offset of the pad center from the centerline. */
  lateral: number;
};

/** Rotating two-armed bar pivoting on the centerline. */
export type SweeperDef = {
  type: 'sweeper';
  id: number;
  s: number;
  cx: number;
  cy: number;
  arm: number;
  thickness: number;
  /** rad/s, sign = direction. */
  omega: number;
  phase: number;
};

/** Wall-anchored dome that pulses between rMin and rMax. */
export type PulsarDef = {
  type: 'pulsar';
  id: number;
  s: number;
  cx: number;
  cy: number;
  /** +1 / -1: which wall (along the track normal) it is anchored to. */
  side: number;
  /** Lateral offset of the dome center (≈ wall position). */
  lateral: number;
  rMin: number;
  rMax: number;
  periodMs: number;
  phase: number;
};

/** A wall across the track with a gap that slides from side to side. */
export type GateWallDef = {
  type: 'gate';
  id: number;
  s: number;
  cx: number;
  cy: number;
  /** Track normal at the gate (axis the gap slides along). */
  nx: number;
  ny: number;
  /** Half extent of the wall across the track (reaches into the walls). */
  reach: number;
  gapHalf: number;
  amplitude: number;
  omega: number;
  phase: number;
  thickness: number;
};

/** Static fin sticking out from one wall (chicanes). */
export type FinDef = {
  type: 'fin';
  id: number;
  s: number;
  side: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
};

/** Static divider island that splits the road into two lanes. */
export type IslandDef = {
  type: 'island';
  id: number;
  sStart: number;
  sEnd: number;
  /** Flattened [x0, y0, x1, y1, …] polyline along the centerline. */
  points: number[];
  r: number;
};

export type ObstacleDef = SweeperDef | PulsarDef | GateWallDef | FinDef | IslandDef;

export type ZoneKind = 'tunnel' | 'split' | 'arena';
export type Zone = {
  kind: ZoneKind;
  sStart: number;
  sEnd: number;
  /** For split zones: the side (+1/-1) of the shorter inner lane. */
  innerSide?: number;
};

export type Track = {
  dateKey: string;
  seed: number;
  name: string;
  archetype: ArchetypeId;
  archetypeLabel: string;
  circuitNo: number;
  clockwise: boolean;
  /** Number of centerline samples (closed loop: sample n-1 connects to 0). */
  n: number;
  step: number;
  length: number;
  xs: Float64Array;
  ys: Float64Array;
  /** Unit tangent per sample. */
  tx: Float64Array;
  ty: Float64Array;
  /** Unit normal per sample (tangent rotated +90°). */
  nx: Float64Array;
  ny: Float64Array;
  /** Half-width per sample. */
  hw: Float64Array;
  /** Cumulative arc length per sample. */
  s: Float64Array;
  /** Signed curvature per sample (1/units). */
  curvature: Float64Array;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  spawn: { x: number; y: number; angle: number };
  /** Start box used by the validator: spawn ± these extents. */
  startBox: { along: number; lateral: number };
  startLine: Gate;
  checkpoints: Gate[];
  boostPads: BoostPad[];
  obstacles: ObstacleDef[];
  zones: Zone[];
  /** How many candidate layouts the generator rolled before one validated. */
  generationAttempts: number;
};
