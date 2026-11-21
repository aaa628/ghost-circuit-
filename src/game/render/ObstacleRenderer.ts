/**
 * Draws the race-clock-driven hazards every frame from the same pure
 * functions the physics uses, so what you see is exactly what you hit.
 */
import type Phaser from 'phaser';
import { COLORS } from '../config';
import { gateGapOffset, pulsarRadius, sweeperAngle } from '../track/Obstacles';
import type { ObstacleDef } from '../track/TrackTypes';

export class ObstacleRenderer {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly dynamic: ObstacleDef[];
  private readonly flashUntil = new Map<number, number>();

  constructor(scene: Phaser.Scene, obstacles: readonly ObstacleDef[]) {
    this.dynamic = obstacles.filter((o) => o.type === 'sweeper' || o.type === 'pulsar' || o.type === 'gate');
    this.g = scene.add.graphics().setDepth(7);
  }

  /** Flash an obstacle white briefly after the car hits it. */
  flash(id: number, wallMs: number): void {
    this.flashUntil.set(id, wallMs + 140);
  }

  private capsule(ax: number, ay: number, bx: number, by: number, r: number): void {
    const g = this.g;
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

  /** White-outlined burgundy capsule (white solid while flashing). */
  private hazard(ax: number, ay: number, bx: number, by: number, r: number, hot: boolean): void {
    this.g.fillStyle(COLORS.hazardEdge, 1);
    this.capsule(ax, ay, bx, by, r + 2);
    if (hot) return;
    this.g.fillStyle(COLORS.hazard, 1);
    this.capsule(ax, ay, bx, by, r);
  }

  /** Redraw for a race time (ms). Culls hazards outside the camera view. */
  draw(tMs: number, wallMs: number, view: Phaser.Geom.Rectangle): void {
    const g = this.g;
    g.clear();
    for (const o of this.dynamic) {
      if (o.type === 'island' || o.type === 'fin') continue;
      if (o.cx < view.x - 260 || o.cx > view.right + 260 || o.cy < view.y - 260 || o.cy > view.bottom + 260) continue;
      const hot = (this.flashUntil.get(o.id) ?? 0) > wallMs;
      if (o.type === 'sweeper') {
        const a = sweeperAngle(o.omega, o.phase, tMs);
        const ex = Math.cos(a) * o.arm;
        const ey = Math.sin(a) * o.arm;
        this.hazard(o.cx + ex, o.cy + ey, o.cx - ex, o.cy - ey, o.thickness, hot);
        g.fillStyle(COLORS.white, 1);
        g.fillCircle(o.cx, o.cy, 5);
      } else if (o.type === 'pulsar') {
        const r = pulsarRadius(o.rMin, o.rMax, o.periodMs, o.phase, tMs);
        this.hazard(o.cx, o.cy, o.cx, o.cy, r, hot);
        g.lineStyle(2, COLORS.white, 0.35);
        g.strokeCircle(o.cx, o.cy, r * 0.6);
      } else if (o.type === 'gate') {
        const c = gateGapOffset(o.amplitude, o.omega, o.phase, tMs);
        const t = o.thickness;
        const segs: Array<[number, number]> = [
          [-o.reach, c - o.gapHalf - t],
          [c + o.gapHalf + t, o.reach],
        ];
        for (const [l0, l1] of segs) {
          if (l1 <= l0) continue;
          this.hazard(o.cx + o.nx * l0, o.cy + o.ny * l0, o.cx + o.nx * l1, o.cy + o.ny * l1, t, hot);
        }
      }
    }
  }

  destroy(): void {
    this.g.destroy();
    this.flashUntil.clear();
  }
}
