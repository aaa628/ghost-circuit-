/**
 * Pre-rendered 3D car sprites.
 *
 * A low-poly car is defined as a handful of convex hexahedra (chassis, cabin,
 * wheels, spoiler) with decals (stripes, lights). At boot we render it from
 * FRAMES headings with a tiny software rasterizer into a sprite-sheet:
 *   • oblique top-down projection (height shears upward on screen), so the car's
 *     ground footprint still matches the physics exactly,
 *   • flat Lambert shading from a light fixed in the WORLD (upper-left), so the
 *     lit and shaded sides stay put while the car turns — that is what sells the
 *     depth,
 *   • a ground shadow cast along the same light.
 * The sprite is never rotated at runtime; we pick the frame for the heading.
 * No assets, no 3D library: ~200 polygons drawn once with Canvas 2D.
 */
import type Phaser from 'phaser';
import { TAU } from '../util/math';

export const CAR_FRAMES = 72;
/** Texture pixels per world unit. */
export const CAR_SPRITE_SCALE = 3;
/** Cars are drawn a touch larger than their hitbox so the 3D detail reads. */
export const CAR_DISPLAY_SCALE = 1.15 / CAR_SPRITE_SCALE;
const FRAME_UNITS = 60;
const FRAME_PX = FRAME_UNITS * CAR_SPRITE_SCALE;
/** Ground center of the car inside each frame (units). */
const CENTER_X = 30;
const CENTER_Y = 30;
const COLS = 12;

/** Oblique projection: screen y = world y − OBLIQUE × height. */
const OBLIQUE = 0.62;
const VIEW = normalize([0, OBLIQUE, 1]);
/** Direction toward the light: from the upper-left, high above. */
const LIGHT = normalize([-0.45, -0.55, 0.85]);

type Vec3 = [number, number, number];
type Material = 'body' | 'accent' | 'glass' | 'tire' | 'rim' | 'head' | 'tail' | 'under';
export type CarPalette = Record<Material, string>;

export const PLAYER_PALETTE: CarPalette = {
  body: '#f4f4f4',
  accent: '#6d001a',
  glass: '#3a4150',
  tire: '#0c0c0c',
  rim: '#8c8c8c',
  head: '#ffffff',
  tail: '#c8264b',
  under: '#202020',
};

/** Greyscale so Phaser's tint can color each ghost slot. */
export const GHOST_PALETTE: CarPalette = {
  body: '#ffffff',
  accent: '#cfcfcf',
  glass: '#7a7a7a',
  tire: '#3a3a3a',
  rim: '#9a9a9a',
  head: '#ffffff',
  tail: '#bdbdbd',
  under: '#4a4a4a',
};

type Decal = { pts: Vec3[]; mat: Material };
type Face = { pts: Vec3[]; mat: Material; decals: Decal[] };
type Part = { faces: Face[]; center: Vec3 };

function normalize(v: number[]): Vec3 {
  const l = Math.hypot(v[0] as number, v[1] as number, v[2] as number) || 1;
  return [(v[0] as number) / l, (v[1] as number) / l, (v[2] as number) / l];
}
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const centroid = (pts: Vec3[]): Vec3 => {
  const c: Vec3 = [0, 0, 0];
  for (const p of pts) {
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  }
  return [c[0] / pts.length, c[1] / pts.length, c[2] / pts.length];
};

type FaceKey = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';

/**
 * Hexahedron from 4 bottom + 4 top corners, each ordered
 * rear-left, front-left, front-right, rear-right (x forward, y right, z up).
 */
function hexa(bottom: Vec3[], top: Vec3[], mats: Partial<Record<FaceKey, Material>>, fallback: Material): Part {
  const [b0, b1, b2, b3] = bottom as [Vec3, Vec3, Vec3, Vec3];
  const [t0, t1, t2, t3] = top as [Vec3, Vec3, Vec3, Vec3];
  const m = (k: FaceKey): Material => mats[k] ?? fallback;
  const faces: Face[] = [
    { pts: [t0, t1, t2, t3], mat: m('top'), decals: [] },
    { pts: [b0, b3, b2, b1], mat: m('bottom'), decals: [] },
    { pts: [b1, b2, t2, t1], mat: m('front'), decals: [] },
    { pts: [b3, b0, t0, t3], mat: m('back'), decals: [] },
    { pts: [b0, b1, t1, t0], mat: m('left'), decals: [] },
    { pts: [b2, b3, t3, t2], mat: m('right'), decals: [] },
  ];
  return { faces, center: centroid([...bottom, ...top]) };
}

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: Material, mats: Partial<Record<FaceKey, Material>> = {}): Part {
  return hexa(
    [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]],
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    mats,
    mat,
  );
}

/** Point on a quad face by bilinear (u along first edge, v along second). */
function onQuad(pts: Vec3[], u: number, v: number, lift = 0.12): Vec3 {
  const [a, b, c, d] = pts as [Vec3, Vec3, Vec3, Vec3];
  const p0: Vec3 = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  const p1: Vec3 = [d[0] + (c[0] - d[0]) * u, d[1] + (c[1] - d[1]) * u, d[2] + (c[2] - d[2]) * u];
  return [p0[0] + (p1[0] - p0[0]) * v, p0[1] + (p1[1] - p0[1]) * v, p0[2] + (p1[2] - p0[2]) * v + lift];
}

function decalRect(face: Face, u0: number, u1: number, v0: number, v1: number, mat: Material): void {
  face.decals.push({
    mat,
    pts: [onQuad(face.pts, u0, v0), onQuad(face.pts, u1, v0), onQuad(face.pts, u1, v1), onQuad(face.pts, u0, v1)],
  });
}

/** Build the car (x forward, y right, z up; body ≈ 34 × 18 units). */
function buildCar(): Part[] {
  const parts: Part[] = [];
  // Wheels first: partly tucked under the body.
  for (const x of [-10.5, 11]) {
    for (const side of [-1, 1]) {
      const yIn = side * 6.5;
      const yOut = side * 9.8;
      parts.push(box(x - 3.4, x + 3.4, Math.min(yIn, yOut), Math.max(yIn, yOut), 0, 4.4, 'tire', { [side > 0 ? 'right' : 'left']: 'rim' }));
    }
  }
  // Chassis: wedge with a lower nose.
  const chassis = hexa(
    [[-17, -8.6, 1.4], [16.5, -7.6, 1.4], [16.5, 7.6, 1.4], [-17, 8.6, 1.4]],
    [[-16.5, -8.3, 5.6], [18, -6.4, 3.9], [18, 6.4, 3.9], [-16.5, 8.3, 5.6]],
    { bottom: 'under' },
    'body',
  );
  const [top, , front, back, left, right] = chassis.faces as [Face, Face, Face, Face, Face, Face];
  decalRect(top, 0.02, 0.98, 0.43, 0.57, 'accent'); // center stripe
  decalRect(left, 0.05, 0.95, 0.2, 0.42, 'accent'); // side skirts
  decalRect(right, 0.05, 0.95, 0.2, 0.42, 'accent');
  decalRect(front, 0.1, 0.32, 0.35, 0.8, 'head'); // headlights
  decalRect(front, 0.68, 0.9, 0.35, 0.8, 'head');
  decalRect(back, 0.08, 0.3, 0.45, 0.85, 'tail'); // tail lights
  decalRect(back, 0.7, 0.92, 0.45, 0.85, 'tail');
  parts.push(chassis);
  // Cabin: glass all round, painted roof with the stripe continuing.
  const cabin = hexa(
    [[-10, -7.2, 5.3], [3.8, -6.8, 4.9], [3.8, 6.8, 4.9], [-10, 7.2, 5.3]],
    [[-8.4, -6.0, 9.6], [-0.6, -5.8, 9.6], [-0.6, 5.8, 9.6], [-8.4, 6.0, 9.6]],
    { top: 'body', bottom: 'under' },
    'glass',
  );
  decalRect(cabin.faces[0] as Face, 0, 1, 0.38, 0.62, 'accent');
  parts.push(cabin);
  // Rear wing on two posts.
  parts.push(box(-16.6, -15.4, -5.5, -4.3, 5.4, 9.2, 'accent'));
  parts.push(box(-16.6, -15.4, 4.3, 5.5, 5.4, 9.2, 'accent'));
  parts.push(box(-18.6, -14.6, -9.4, 9.4, 9.2, 10.6, 'accent'));
  return parts;
}

function shadeColor(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * k));
  const b = Math.min(255, Math.round((n & 255) * k));
  return `rgb(${r},${g},${b})`;
}

/** Lambert term with a little ambient; glass also gets a flat sky reflection. */
function lightFactor(normal: Vec3, mat: Material): number {
  const lambert = Math.max(0, dot(normal, LIGHT));
  if (mat === 'head' || mat === 'tail') return 0.9 + 0.1 * lambert;
  if (mat === 'glass') return 0.7 + 0.9 * Math.pow(lambert, 3);
  return 0.38 + 0.62 * lambert;
}

type Projected = { pts: Array<[number, number]>; depth: number; color: string; decals: Array<{ pts: Array<[number, number]>; color: string }> };

function drawFrame(
  ctx: CanvasRenderingContext2D,
  parts: Part[],
  heading: number,
  palette: CarPalette,
): void {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const rot = (p: Vec3): Vec3 => [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
  const proj = (p: Vec3): [number, number] => [p[0] + CENTER_X, p[1] - OBLIQUE * p[2] + CENTER_Y];

  // Sort whole convex parts back-to-front (reliable for a car made of blocks);
  // inside a part, back-face culling leaves only non-overlapping faces.
  const ordered = parts
    .map((part) => ({ part, depth: dot(rot(part.center), VIEW) }))
    .sort((a, b) => a.depth - b.depth);
  const faces: Projected[] = [];
  for (const { part, depth: partDepth } of ordered) {
    const center = rot(part.center);
    for (const f of part.faces) {
      const pts = f.pts.map(rot);
      let n = normalize(cross(sub(pts[1] as Vec3, pts[0] as Vec3), sub(pts[2] as Vec3, pts[0] as Vec3)));
      const fc = centroid(pts);
      if (dot(n, sub(fc, center)) < 0) n = [-n[0], -n[1], -n[2]];
      if (dot(n, VIEW) <= 0.02) continue; // back-face
      faces.push({
        pts: pts.map(proj),
        depth: partDepth * 1000 + dot(fc, VIEW),
        color: shadeColor(palette[f.mat], lightFactor(n, f.mat)),
        decals: f.decals.map((d) => ({
          pts: d.pts.map((p) => proj(rot(p))),
          color: shadeColor(palette[d.mat], lightFactor(n, d.mat)),
        })),
      });
    }
  }
  faces.sort((a, b) => a.depth - b.depth);
  const poly = (pts: Array<[number, number]>, color: string): void => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.fill();
    ctx.stroke(); // closes hairline seams between adjacent faces
  };
  ctx.lineWidth = 0.35;
  ctx.lineJoin = 'round';
  for (const f of faces) {
    poly(f.pts, f.color);
    for (const d of f.decals) poly(d.pts, d.color);
  }
}

/** Frame index for a heading in radians (0 = facing +x). */
export function carFrameFor(angle: number): number {
  const step = TAU / CAR_FRAMES;
  let i = Math.round(angle / step) % CAR_FRAMES;
  if (i < 0) i += CAR_FRAMES;
  return i;
}

/** Sprite origin so the car's ground center sits on the physics position. */
export const CAR_ORIGIN = { x: CENTER_X / FRAME_UNITS, y: CENTER_Y / FRAME_UNITS } as const;

/** Render the 72-heading sprite sheet into a Phaser canvas texture. */
export function ensureCarAtlas(scene: Phaser.Scene, key: string, palette: CarPalette, withShadow: boolean): void {
  if (scene.textures.exists(key)) return;
  const rows = Math.ceil(CAR_FRAMES / COLS);
  const tex = scene.textures.createCanvas(key, COLS * FRAME_PX, rows * FRAME_PX);
  if (!tex) return;
  const ctx = tex.getContext();
  const parts = buildCar();
  const shadowCanvas = withShadow ? document.createElement('canvas') : null;
  if (shadowCanvas) {
    shadowCanvas.width = FRAME_PX;
    shadowCanvas.height = FRAME_PX;
  }
  const shadowCtx = shadowCanvas ? shadowCanvas.getContext('2d') : null;
  for (let i = 0; i < CAR_FRAMES; i++) {
    const fx = (i % COLS) * FRAME_PX;
    const fy = Math.floor(i / COLS) * FRAME_PX;
    const heading = (i / CAR_FRAMES) * TAU;
    if (shadowCtx && shadowCanvas) {
      shadowCtx.setTransform(1, 0, 0, 1, 0, 0);
      shadowCtx.clearRect(0, 0, FRAME_PX, FRAME_PX);
      shadowCtx.setTransform(CAR_SPRITE_SCALE, 0, 0, CAR_SPRITE_SCALE, 0, 0);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(fx, fy, FRAME_PX, FRAME_PX);
    ctx.clip();
    ctx.setTransform(CAR_SPRITE_SCALE, 0, 0, CAR_SPRITE_SCALE, fx, fy);
    // Shadow: drawn opaque on its own canvas (no overlap darkening), then composited.
    if (shadowCtx && shadowCanvas) {
      drawShadow(shadowCtx, parts, heading);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 0.38;
      ctx.drawImage(shadowCanvas, fx, fy);
      ctx.globalAlpha = 1;
      ctx.setTransform(CAR_SPRITE_SCALE, 0, 0, CAR_SPRITE_SCALE, fx, fy);
    }
    drawFrame(ctx, parts, heading, palette);
    ctx.restore();
    tex.add(i, 0, fx, fy, FRAME_PX, FRAME_PX);
  }
  tex.refresh();
}

/** Every face projected along the light onto the ground (z = 0). */
function drawShadow(shadowCtx: CanvasRenderingContext2D, parts: Part[], heading: number): void {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  shadowCtx.fillStyle = '#000000';
  for (const part of parts) {
    for (const f of part.faces) {
      shadowCtx.beginPath();
      f.pts.forEach((p, i) => {
        const x = p[0] * c - p[1] * s;
        const y = p[0] * s + p[1] * c;
        const t = p[2] / LIGHT[2];
        const gx = x - LIGHT[0] * t + CENTER_X;
        const gy = y - LIGHT[1] * t + CENTER_Y;
        if (i === 0) shadowCtx.moveTo(gx, gy);
        else shadowCtx.lineTo(gx, gy);
      });
      shadowCtx.closePath();
      shadowCtx.fill();
    }
  }
}
