/**
 * Draws a circuit once (grid, road, sector-coloured neon walls, start grid,
 * tunnels, arenas, static hazards) and animates the cheap dynamic bits each
 * frame (checkpoint states, boost-pad shimmer, finish-line pulse).
 */
import Phaser from 'phaser';
import { COLORS, TRACK } from '../config';
import type { Gate, Track } from '../track/TrackTypes';

type GateView = { gate: Gate; g: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text };

const DEPTH = { grid: 0, road: 1, zone: 2, pads: 3, gates: 4, walls: 5, statics: 6 } as const;

function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  );
}

export class TrackRenderer {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly gateViews: GateView[] = [];
  private readonly padViews: Phaser.GameObjects.Graphics[] = [];
  private finishGlow: Phaser.GameObjects.Graphics | null = null;
  private nextCheckpoint = 0;

  constructor(private readonly scene: Phaser.Scene, private readonly track: Track) {
    this.drawGrid();
    this.drawRoad();
    this.drawZones();
    this.drawPads();
    this.drawGates();
    this.drawWalls();
    this.drawStartLine();
    this.drawStaticHazards();
    this.setCheckpointState(0);
  }

  private add<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.objects.push(obj);
    return obj;
  }

  private edge(i: number, side: number, extra = 0): { x: number; y: number } {
    const t = this.track;
    const hw = (t.hw[i] as number) + extra;
    return {
      x: (t.xs[i] as number) + (t.nx[i] as number) * hw * side,
      y: (t.ys[i] as number) + (t.ny[i] as number) * hw * side,
    };
  }

  private drawGrid(): void {
    const b = this.track.bounds;
    const margin = 1400;
    const x0 = Math.floor((b.minX - margin) / 120) * 120;
    const x1 = b.maxX + margin;
    const y0 = Math.floor((b.minY - margin) / 120) * 120;
    const y1 = b.maxY + margin;
    const g = this.add(this.scene.add.graphics()).setDepth(DEPTH.grid);
    g.fillStyle(COLORS.background, 1);
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    for (let x = x0; x <= x1; x += 120) {
      const major = Math.round(x / 120) % 5 === 0;
      g.lineStyle(major ? 2 : 1, major ? COLORS.gridMajor : COLORS.grid, major ? 0.55 : 0.4);
      g.lineBetween(x, y0, x, y1);
    }
    for (let y = y0; y <= y1; y += 120) {
      const major = Math.round(y / 120) % 5 === 0;
      g.lineStyle(major ? 2 : 1, major ? COLORS.gridMajor : COLORS.grid, major ? 0.55 : 0.4);
      g.lineBetween(x0, y, x1, y);
    }
  }

  private drawRoad(): void {
    const t = this.track;
    const g = this.add(this.scene.add.graphics()).setDepth(DEPTH.road);
    // Soft shoulder glow under the road.
    g.fillStyle(COLORS.roadEdge, 1);
    for (let i = 0; i < t.n; i++) {
      const j = (i + 1) % t.n;
      const a = this.edge(i, 1, 10);
      const b = this.edge(j, 1, 10);
      const c = this.edge(j, -1, 10);
      const d = this.edge(i, -1, 10);
      g.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
      g.fillTriangle(a.x, a.y, c.x, c.y, d.x, d.y);
    }
    g.fillStyle(COLORS.road, 1);
    for (let i = 0; i < t.n; i++) {
      const j = (i + 1) % t.n;
      const a = this.edge(i, 1);
      const b = this.edge(j, 1);
      const c = this.edge(j, -1);
      const d = this.edge(i, -1);
      g.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
      g.fillTriangle(a.x, a.y, c.x, c.y, d.x, d.y);
    }
    // Faint center dashes for speed reading.
    g.lineStyle(2, 0x3a4380, 0.35);
    for (let i = 0; i < t.n; i += 8) {
      const j = (i + 3) % t.n;
      g.lineBetween(t.xs[i] as number, t.ys[i] as number, t.xs[j] as number, t.ys[j] as number);
    }
  }

  private drawZones(): void {
    const t = this.track;
    const g = this.add(this.scene.add.graphics()).setDepth(DEPTH.zone);
    for (const z of t.zones) {
      const i0 = Math.round(z.sStart / t.step);
      const i1 = Math.round(z.sEnd / t.step);
      if (z.kind === 'tunnel') {
        g.fillStyle(0x000000, 0.38);
        for (let i = i0; i < i1; i++) {
          const a = this.edge(i % t.n, 1);
          const b = this.edge((i + 1) % t.n, 1);
          const c = this.edge((i + 1) % t.n, -1);
          const d = this.edge(i % t.n, -1);
          g.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
          g.fillTriangle(a.x, a.y, c.x, c.y, d.x, d.y);
        }
        for (let i = i0 + 2; i < i1 - 1; i += 5) {
          const a = this.edge(i % t.n, 1, 6);
          const b = this.edge(i % t.n, -1, 6);
          g.lineStyle(10, 0x9d5cff, 0.12);
          g.lineBetween(a.x, a.y, b.x, b.y);
          g.lineStyle(2.5, 0xc59bff, 0.55);
          g.lineBetween(a.x, a.y, b.x, b.y);
        }
      } else if (z.kind === 'split') {
        // Lane guide arrows.
        g.lineStyle(3, 0x7cf9ff, 0.25);
        for (let i = i0 + 18; i < i1 - 18; i += 9) {
          for (const side of [-1, 1]) {
            const lat = side * (TRACK.HALF_WIDTH * TRACK.WIDE_MULT * 0.55);
            const k = i % t.n;
            const cx = (t.xs[k] as number) + (t.nx[k] as number) * lat;
            const cy = (t.ys[k] as number) + (t.ny[k] as number) * lat;
            const tx = t.tx[k] as number;
            const ty = t.ty[k] as number;
            const nx = t.nx[k] as number;
            const ny = t.ny[k] as number;
            g.lineBetween(cx - tx * 8 + nx * 8, cy - ty * 8 + ny * 8, cx + tx * 6, cy + ty * 6);
            g.lineBetween(cx - tx * 8 - nx * 8, cy - ty * 8 - ny * 8, cx + tx * 6, cy + ty * 6);
          }
        }
      } else {
        // Arena: hazard hatching along both walls.
        for (let i = i0 + 4; i < i1 - 4; i += 3) {
          for (const side of [-1, 1]) {
            const a = this.edge(i % t.n, side, -2);
            const b = this.edge((i + 2) % t.n, side, -18);
            g.lineStyle(3, COLORS.hazard, 0.22);
            g.lineBetween(a.x, a.y, b.x, b.y);
          }
        }
      }
    }
    // Sweeper danger discs.
    for (const o of t.obstacles) {
      if (o.type === 'sweeper') {
        g.lineStyle(2, COLORS.hazard, 0.25);
        g.strokeCircle(o.cx, o.cy, o.arm + o.thickness);
        g.fillStyle(COLORS.hazard, 0.05);
        g.fillCircle(o.cx, o.cy, o.arm + o.thickness);
      }
    }
  }

  private drawPads(): void {
    for (const p of this.track.boostPads) {
      const g = this.add(this.scene.add.graphics()).setDepth(DEPTH.pads);
      g.setBlendMode(Phaser.BlendModes.ADD);
      const corner = (a: number, l: number): { x: number; y: number } => ({
        x: p.cx + p.tx * a + p.nx * l,
        y: p.cy + p.ty * a + p.ny * l,
      });
      const c1 = corner(-p.halfLength, -p.halfWidth);
      const c2 = corner(p.halfLength, -p.halfWidth);
      const c3 = corner(p.halfLength, p.halfWidth);
      const c4 = corner(-p.halfLength, p.halfWidth);
      g.fillStyle(COLORS.boost, 0.14);
      g.fillTriangle(c1.x, c1.y, c2.x, c2.y, c3.x, c3.y);
      g.fillTriangle(c1.x, c1.y, c3.x, c3.y, c4.x, c4.y);
      g.lineStyle(2, COLORS.boost, 0.7);
      g.strokePoints([c1, c2, c3, c4], true);
      for (let k = 0; k < 3; k++) {
        const a = -p.halfLength + 18 + k * 26;
        const tip = corner(a + 12, 0);
        const l = corner(a - 4, -p.halfWidth + 6);
        const r = corner(a - 4, p.halfWidth - 6);
        g.lineStyle(9, COLORS.boost, 0.18);
        g.strokePoints([l, tip, r], false);
        g.lineStyle(3.5, 0xeaffb0, 0.95);
        g.strokePoints([l, tip, r], false);
      }
      this.padViews.push(g);
    }
  }

  private drawGates(): void {
    this.track.checkpoints.forEach((gate, k) => {
      const g = this.add(this.scene.add.graphics()).setDepth(DEPTH.gates);
      g.setBlendMode(Phaser.BlendModes.ADD);
      const segs = 9;
      for (let s = 0; s < segs; s++) {
        if (s % 2 === 1) continue;
        const u0 = s / segs;
        const u1 = (s + 1) / segs;
        const x0 = gate.ax + (gate.bx - gate.ax) * u0;
        const y0 = gate.ay + (gate.by - gate.ay) * u0;
        const x1 = gate.ax + (gate.bx - gate.ax) * u1;
        const y1 = gate.ay + (gate.by - gate.ay) * u1;
        g.lineStyle(12, COLORS.checkpoint, 0.16);
        g.lineBetween(x0, y0, x1, y1);
        g.lineStyle(3, COLORS.checkpoint, 1);
        g.lineBetween(x0, y0, x1, y1);
      }
      const lx = gate.cx + gate.tx * 26;
      const ly = gate.cy + gate.ty * 26;
      const label = this.add(
        this.scene.add
          .text(lx, ly, `${k + 1}`, {
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: '26px',
            fontStyle: 'bold',
            color: '#7cf9ff',
          })
          .setOrigin(0.5)
          .setResolution(Math.min(3, globalThis.devicePixelRatio || 1))
          .setDepth(DEPTH.gates)
          .setAlpha(0.7),
      );
      this.gateViews.push({ gate, g, label });
    });
  }

  private drawWalls(): void {
    const t = this.track;
    const g = this.add(this.scene.add.graphics()).setDepth(DEPTH.walls);
    g.setBlendMode(Phaser.BlendModes.ADD);
    const bounds = [0, ...t.checkpoints.map((c) => c.index), t.n];
    for (let k = 0; k + 1 < bounds.length; k++) {
      const from = bounds[k] as number;
      const to = bounds[k + 1] as number;
      const color = COLORS.sector[k % COLORS.sector.length] as number;
      const hot = mix(color, 0xffffff, 0.55);
      for (const side of [1, -1]) {
        const pts: Array<{ x: number; y: number }> = [];
        for (let i = from; i <= to; i++) pts.push(this.edge(i % t.n, side));
        g.lineStyle(18, color, 0.08);
        g.strokePoints(pts, false);
        g.lineStyle(8, color, 0.22);
        g.strokePoints(pts, false);
        g.lineStyle(2.6, hot, 1);
        g.strokePoints(pts, false);
      }
    }
  }

  private drawStartLine(): void {
    const t = this.track;
    const gate = t.startLine;
    const g = this.add(this.scene.add.graphics()).setDepth(DEPTH.gates);
    const size = 12;
    const hw = gate.halfWidth;
    const count = Math.floor((2 * hw) / size);
    const nx = t.nx[0] as number;
    const ny = t.ny[0] as number;
    const tx = gate.tx;
    const ty = gate.ty;
    for (let row = 0; row < 2; row++) {
      for (let c = 0; c < count; c++) {
        const white = (row + c) % 2 === 0;
        g.fillStyle(white ? 0xffffff : 0x0b0d1c, white ? 0.9 : 0.9);
        const l0 = -hw + c * size;
        const a0 = row * size - size;
        const p = (a: number, l: number): { x: number; y: number } => ({
          x: gate.cx + tx * a + nx * l,
          y: gate.cy + ty * a + ny * l,
        });
        const q1 = p(a0, l0);
        const q2 = p(a0 + size, l0);
        const q3 = p(a0 + size, l0 + size);
        const q4 = p(a0, l0 + size);
        g.fillTriangle(q1.x, q1.y, q2.x, q2.y, q3.x, q3.y);
        g.fillTriangle(q1.x, q1.y, q3.x, q3.y, q4.x, q4.y);
      }
    }
    // Grid slot behind the line.
    const sp = t.spawn;
    g.lineStyle(2, 0xffffff, 0.35);
    const ca = Math.cos(sp.angle);
    const sa = Math.sin(sp.angle);
    const box = (a: number, l: number): { x: number; y: number } => ({ x: sp.x + ca * a - sa * l, y: sp.y + sa * a + ca * l });
    g.strokePoints([box(-22, -16), box(20, -16), box(20, 16), box(-22, 16)], true);

    const fg = this.add(this.scene.add.graphics()).setDepth(DEPTH.gates);
    fg.setBlendMode(Phaser.BlendModes.ADD);
    fg.lineStyle(26, 0xffffff, 0.12);
    fg.lineBetween(gate.ax, gate.ay, gate.bx, gate.by);
    fg.lineStyle(5, 0xffffff, 0.9);
    fg.lineBetween(gate.ax, gate.ay, gate.bx, gate.by);
    fg.setVisible(false);
    this.finishGlow = fg;
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

  private drawStaticHazards(): void {
    const g = this.add(this.scene.add.graphics()).setDepth(DEPTH.statics);
    for (const o of this.track.obstacles) {
      if (o.type === 'fin') {
        g.fillStyle(0xff6b3d, 0.16);
        this.capsule(g, o.ax, o.ay, o.bx, o.by, o.r + 7);
        g.fillStyle(0x2a0f12, 1);
        this.capsule(g, o.ax, o.ay, o.bx, o.by, o.r);
        g.lineStyle(2.5, 0xff8a5c, 1);
        g.strokeCircle(o.bx, o.by, o.r);
      } else if (o.type === 'island') {
        const p = o.points;
        g.fillStyle(0xff4fd8, 0.12);
        for (let i = 0; i + 3 < p.length; i += 2) {
          this.capsule(g, p[i] as number, p[i + 1] as number, p[i + 2] as number, p[i + 3] as number, o.r + 8);
        }
        g.fillStyle(0x1a0b22, 1);
        for (let i = 0; i + 3 < p.length; i += 2) {
          this.capsule(g, p[i] as number, p[i + 1] as number, p[i + 2] as number, p[i + 3] as number, o.r);
        }
        g.lineStyle(2, 0xff9ff0, 0.85);
        const pts: Array<{ x: number; y: number }> = [];
        for (let i = 0; i + 1 < p.length; i += 2) pts.push({ x: p[i] as number, y: p[i + 1] as number });
        g.strokePoints(pts, false);
      }
    }
  }

  /** Highlight the next gate (or the finish line once all are cleared). */
  setCheckpointState(next: number): void {
    this.nextCheckpoint = next;
    this.gateViews.forEach((v, k) => {
      const passed = k < next;
      const isNext = k === next;
      v.g.setAlpha(passed ? 0.12 : isNext ? 1 : 0.3);
      v.label.setAlpha(passed ? 0.2 : isNext ? 1 : 0.45);
      v.label.setColor(passed ? '#3a4a7a' : '#7cf9ff');
    });
    this.finishGlow?.setVisible(next >= this.gateViews.length);
  }

  /** Per-frame animation (race clock driven so it pauses with the game). */
  update(visualMs: number, wallMs: number): void {
    const pulse = 0.65 + 0.35 * Math.sin(wallMs / 140);
    const next = this.gateViews[this.nextCheckpoint];
    if (next) next.g.setAlpha(pulse);
    if (this.finishGlow?.visible) this.finishGlow.setAlpha(0.55 + 0.45 * Math.sin(wallMs / 110));
    this.padViews.forEach((g, i) => g.setAlpha(0.7 + 0.3 * Math.sin(visualMs / 90 + i * 1.7)));
  }

  destroy(): void {
    for (const o of this.objects) o.destroy();
    this.objects.length = 0;
    this.gateViews.length = 0;
    this.padViews.length = 0;
    this.finishGlow = null;
  }
}
