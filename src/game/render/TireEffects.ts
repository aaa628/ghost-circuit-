/**
 * Driving effects that sell grip and impact:
 *   • skid marks  — dark rubber strips laid by the rear tyres while drifting,
 *                   sliding or braking hard (ring buffer, cleared on restart)
 *   • tyre smoke  — grey puffs from the rear wheels that swell and fade
 *   • sparks      — hot streaks thrown out of wall / hazard impacts
 * Flat colours, normal blending. All cosmetic: nothing here touches physics.
 */
import Phaser from 'phaser';

const MAX_SKID_SEGMENTS = 900;
const MAX_SPARKS = 160;
const MAX_PUFFS = 140;

type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: number; width: number };
type Puff = { x: number; y: number; vx: number; vy: number; life: number; max: number; r0: number; r1: number };

export class TireEffects {
  private readonly skidGfx: Phaser.GameObjects.Graphics;
  private readonly smokeGfx: Phaser.GameObjects.Graphics;
  private readonly sparkGfx: Phaser.GameObjects.Graphics;
  /** Flattened [x0, y0, x1, y1, alpha] per segment. */
  private readonly skids = new Float32Array(MAX_SKID_SEGMENTS * 5);
  private skidCount = 0;
  private skidHead = 0;
  private skidDirty = false;
  private readonly sparks: Spark[] = [];
  private readonly puffs: Puff[] = [];

  constructor(scene: Phaser.Scene) {
    this.skidGfx = scene.add.graphics().setDepth(2.5);
    this.smokeGfx = scene.add.graphics().setDepth(10.4);
    this.sparkGfx = scene.add.graphics().setDepth(12);
  }

  /** Lay a rubber strip from (x0,y0) to (x1,y1); strength 0..1 sets darkness. */
  skid(x0: number, y0: number, x1: number, y1: number, strength: number): void {
    const o = this.skidHead * 5;
    this.skids[o] = x0;
    this.skids[o + 1] = y0;
    this.skids[o + 2] = x1;
    this.skids[o + 3] = y1;
    this.skids[o + 4] = 0.18 + 0.32 * Math.min(1, strength);
    this.skidHead = (this.skidHead + 1) % MAX_SKID_SEGMENTS;
    this.skidCount = Math.min(MAX_SKID_SEGMENTS, this.skidCount + 1);
    this.skidDirty = true;
  }

  /** A puff of tyre smoke drifting backwards from a wheel. */
  smoke(x: number, y: number, driftX: number, driftY: number, amount: number): void {
    if (this.puffs.length >= MAX_PUFFS) this.puffs.shift();
    const a = Math.random() * Math.PI * 2;
    const jitter = 12 + 18 * Math.random();
    this.puffs.push({
      x: x + (Math.random() - 0.5) * 4,
      y: y + (Math.random() - 0.5) * 4,
      vx: driftX + Math.cos(a) * jitter,
      vy: driftY + Math.sin(a) * jitter,
      life: 0,
      max: 0.55 + 0.45 * Math.random(),
      r0: 4 + 3 * amount,
      r1: 14 + 14 * amount,
    });
  }

  /** Burst of sparks at an impact, thrown roughly along `dirX, dirY`. */
  sparkBurst(x: number, y: number, dirX: number, dirY: number, intensity: number): void {
    const count = Math.round(8 + 22 * Math.min(1, intensity));
    const base = Math.atan2(dirY, dirX);
    for (let i = 0; i < count; i++) {
      if (this.sparks.length >= MAX_SPARKS) this.sparks.shift();
      const a = base + (Math.random() - 0.5) * 2.2;
      const sp = 160 + 420 * Math.random() * (0.5 + intensity);
      const hot = Math.random();
      this.sparks.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0,
        max: 0.18 + 0.3 * Math.random(),
        color: hot < 0.55 ? 0xfff4d6 : hot < 0.85 ? 0xffffff : 0xc8264b,
        width: 1.2 + 1.6 * Math.random(),
      });
    }
  }

  /** Advance smoke and sparks; redraw skid marks only when they changed. */
  update(dtMs: number): void {
    const dt = Math.min(0.05, dtMs / 1000);

    if (this.skidDirty) {
      this.skidDirty = false;
      const g = this.skidGfx;
      g.clear();
      const start = (this.skidHead - this.skidCount + MAX_SKID_SEGMENTS) % MAX_SKID_SEGMENTS;
      for (let k = 0; k < this.skidCount; k++) {
        const o = ((start + k) % MAX_SKID_SEGMENTS) * 5;
        // Oldest marks fade out as the buffer fills.
        const age = 1 - k / MAX_SKID_SEGMENTS;
        g.lineStyle(4.5, 0x050505, (this.skids[o + 4] as number) * (1 - 0.6 * age));
        g.lineBetween(this.skids[o] as number, this.skids[o + 1] as number, this.skids[o + 2] as number, this.skids[o + 3] as number);
      }
    }

    const sg = this.smokeGfx;
    sg.clear();
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i] as Puff;
      p.life += dt;
      if (p.life >= p.max) {
        this.puffs.splice(i, 1);
        continue;
      }
      const k = p.life / p.max;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 2.2 * dt;
      p.vy *= 1 - 2.2 * dt;
      sg.fillStyle(k < 0.3 ? 0x9a9a9a : 0x7a7a7a, 0.32 * (1 - k));
      sg.fillCircle(p.x, p.y, p.r0 + (p.r1 - p.r0) * Math.sqrt(k));
    }

    const kg = this.sparkGfx;
    kg.clear();
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i] as Spark;
      s.life += dt;
      if (s.life >= s.max) {
        this.sparks.splice(i, 1);
        continue;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 1 - 4 * dt;
      s.vy *= 1 - 4 * dt;
      const k = 1 - s.life / s.max;
      kg.lineStyle(s.width, s.color, k);
      kg.lineBetween(s.x, s.y, s.x - s.vx * 0.035, s.y - s.vy * 0.035);
    }
  }

  /** Instant retry: wipe everything. */
  clear(): void {
    this.skidCount = 0;
    this.skidHead = 0;
    this.skidDirty = true;
    this.sparks.length = 0;
    this.puffs.length = 0;
    this.smokeGfx.clear();
    this.sparkGfx.clear();
  }

  destroy(): void {
    this.skidGfx.destroy();
    this.smokeGfx.destroy();
    this.sparkGfx.destroy();
  }
}
