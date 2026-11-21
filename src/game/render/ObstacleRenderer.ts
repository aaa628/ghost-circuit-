/**
 * Draws the race-clock-driven hazards every frame from the same pure
 * functions the physics uses, so what you see is exactly what you hit.
 */
import Phaser from 'phaser';
import { COLORS } from '../config';
import { gateGapOffset, pulsarRadius, sweeperAngle } from '../track/Obstacles';
import type { ObstacleDef } from '../track/TrackTypes';

export class ObstacleRenderer {
  private readonly glow: Phaser.GameObjects.Graphics;
  private readonly core: Phaser.GameObjects.Graphics;
  private readonly dynamic: ObstacleDef[];
  private readonly flashUntil = new Map<number, number>();

  constructor(scene: Phaser.Scene, obstacles: readonly ObstacleDef[]) {
    this.dynamic = obstacles.filter((o) => o.type === 'sweeper' || o.type === 'pulsar' || o.type === 'gate');
    this.glow = scene.add.graphics().setDepth(7).setBlendMode(Phaser.BlendModes.ADD);
    this.core = scene.add.graphics().setDepth(7.5);
  }

  /** Flash an obstacle briefly after the car hits it. */
  flash(id: number, wallMs: number): void {
    this.flashUntil.set(id, wallMs + 160);
  }

  private capsule(g: Phaser.GameObjects.Graphics, ax: number, ay: number, bx: number, by: number, r: number): void {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy);
    g.fillCircle(ax, ay, r);
    g.fillCircle(bx, by, r);
    if (len < 1e-3) return;
    const px = (-dy / len) * r;
    const py = (dx / len) * r;
    g.fillTriangle(ax + px, ay + py, bx + px, by + py, bx - px, by - py);
    g.fillTriangle(ax + px, ay + py, bx - px, by - py, ax - px, ay - py);
  }

  /** Redraw for a race time (ms). Culls hazards outside the camera view. */
  draw(tMs: number, wallMs: number, view: Phaser.Geom.Rectangle): void {
    const glow = this.glow;
    const core = this.core;
    glow.clear();
    core.clear();
    for (const o of this.dynamic) {
      if (o.type === 'island' || o.type === 'fin') continue;
      if (o.cx < view.x - 260 || o.cx > view.right + 260 || o.cy < view.y - 260 || o.cy > view.bottom + 260) continue;
      const hot = (this.flashUntil.get(o.id) ?? 0) > wallMs;
      const color = hot ? COLORS.hazardHot : COLORS.hazard;
      if (o.type === 'sweeper') {
        const a = sweeperAngle(o.omega, o.phase, tMs);
        const ex = Math.cos(a) * o.arm;
        const ey = Math.sin(a) * o.arm;
        glow.fillStyle(color, 0.18);
        this.capsule(glow, o.cx + ex, o.cy + ey, o.cx - ex, o.cy - ey, o.thickness + 9);
        core.fillStyle(0x2a0710, 1);
        this.capsule(core, o.cx + ex, o.cy + ey, o.cx - ex, o.cy - ey, o.thickness);
        core.lineStyle(2.5, color, 1);
        core.lineBetween(o.cx + ex, o.cy + ey, o.cx - ex, o.cy - ey);
        core.fillStyle(color, 1);
        core.fillCircle(o.cx, o.cy, 6);
        core.fillCircle(o.cx + ex, o.cy + ey, 3.5);
        core.fillCircle(o.cx - ex, o.cy - ey, 3.5);
      } else if (o.type === 'pulsar') {
        const r = pulsarRadius(o.rMin, o.rMax, o.periodMs, o.phase, tMs);
        const k = (r - o.rMin) / Math.max(1, o.rMax - o.rMin);
        glow.fillStyle(color, 0.1 + 0.18 * k);
        glow.fillCircle(o.cx, o.cy, r + 12);
        core.fillStyle(0x2a0710, 0.92);
        core.fillCircle(o.cx, o.cy, r);
        core.lineStyle(3, color, 0.65 + 0.35 * k);
        core.strokeCircle(o.cx, o.cy, r);
        core.lineStyle(1.5, color, 0.4);
        core.strokeCircle(o.cx, o.cy, r * 0.62);
      } else if (o.type === 'gate') {
        const c = gateGapOffset(o.amplitude, o.omega, o.phase, tMs);
        const t = o.thickness;
        const segs: Array<[number, number]> = [
          [-o.reach, c - o.gapHalf - t],
          [c + o.gapHalf + t, o.reach],
        ];
        for (const [l0, l1] of segs) {
          if (l1 <= l0) continue;
          const ax = o.cx + o.nx * l0;
          const ay = o.cy + o.ny * l0;
          const bx = o.cx + o.nx * l1;
          const by = o.cy + o.ny * l1;
          glow.fillStyle(color, 0.16);
          this.capsule(glow, ax, ay, bx, by, t + 9);
          core.fillStyle(0x2a0710, 1);
          this.capsule(core, ax, ay, bx, by, t);
          core.lineStyle(2, color, 1);
          core.lineBetween(ax, ay, bx, by);
        }
        // Bright gap edges.
        const gx0 = o.cx + o.nx * (c - o.gapHalf);
        const gy0 = o.cy + o.ny * (c - o.gapHalf);
        const gx1 = o.cx + o.nx * (c + o.gapHalf);
        const gy1 = o.cy + o.ny * (c + o.gapHalf);
        core.fillStyle(0xfff1a8, 1);
        core.fillCircle(gx0, gy0, 3);
        core.fillCircle(gx1, gy1, 3);
      }
    }
  }

  destroy(): void {
    this.glow.destroy();
    this.core.destroy();
    this.flashUntil.clear();
  }
}
