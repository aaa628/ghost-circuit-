/** Small allocation-free math helpers used by the simulation hot paths. */

export const TAU = Math.PI * 2;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Wrap an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  else if (r > Math.PI) r -= TAU;
  return r;
}

/** Shortest signed difference b - a in (-π, π]. */
export function angleDelta(a: number, b: number): number {
  return wrapAngle(b - a);
}

/** Shortest-arc angle interpolation (2D "slerp"). */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDelta(a, b) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function hypot2(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}

/** Parameter u∈[0,1] of the closest point on segment AB to P. */
export function closestParamOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-12) return 0;
  return clamp(((px - ax) * abx + (py - ay) * aby) / len2, 0, 1);
}

/**
 * Intersection of segment P(p0→p1) with segment Q(q0→q1).
 * Returns the parameter along P in [0,1], or -1 when they don't intersect.
 */
export function segmentIntersect(
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  q0x: number,
  q0y: number,
  q1x: number,
  q1y: number,
): number {
  const rX = p1x - p0x;
  const rY = p1y - p0y;
  const sX = q1x - q0x;
  const sY = q1y - q0y;
  const denom = rX * sY - rY * sX;
  if (Math.abs(denom) < 1e-12) return -1;
  const qpX = q0x - p0x;
  const qpY = q0y - p0y;
  const t = (qpX * sY - qpY * sX) / denom;
  const u = (qpX * rY - qpY * rX) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return -1;
  return t;
}

/** Round to a fixed number of decimals using an integer scale (e.g. 10 → 0.1). */
export function quantize(v: number, scale: number): number {
  return Math.round(v * scale) / scale;
}
