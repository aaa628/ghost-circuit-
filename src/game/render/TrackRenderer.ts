/**
 * Draws a circuit once — flat asphalt, burgundy/white racing curbs, checkered
 * start line, tunnels, arenas and static hazards — and updates checkpoint
 * states during the race. Flat fills only: no blend modes, no glow passes.
 */
import Phaser from 'phaser';
import { COLORS, TRACK } from '../config';
import type { Gate, Track } from '../track/TrackTypes';

type GateView = { gate: Gate; g: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text };

const DEPTH = { grid: 0, road: 1, zone: 2, pads: 3, gates: 4, walls: 5, statics: 6 } as const;

/** Curb width outside the road edge, and length of each colored block. */
const CURB_WIDTH = 9;
const CURB_SAMPLES = 2;

export class TrackRenderer {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly gateViews: GateView[] = [];
  private finishMark: Phaser.GameObjects.Graphics | null = null;

  constructor(private readonly scene: Phaser.Scene, private readonly track: Track) {
    this.drawGround();
    this.drawRoad();
    this.drawZones();
    this.drawPads();
    this.drawGates();
    this.drawCurbs();
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
    const k = ((i % t.n) + t.n) % t.n;
    const hw = (t.hw[k] as number) + extra;
    return {
      x: (t.xs[k] as number) + (t.nx[k] as number) * hw * side,
      y: (t.ys[k] as number) + (t.ny[k] as number) * hw * side,
    };
  }

  private quad(g: Phaser.GameObjects.Graphics, i: number, sideA: number, extraA: number, sideB: number, extraB: number): void {
    const a = this.edge(i, sideA, extraA);
    const b = this.edge(i + 1, sideA, extraA);
    const c = this.edge(i + 1, sideB, extraB);
    const d = this.edge(i, sideB, extraB);
    g.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
    g.fillTriangle(a.x, a.y, c.x, c.y, d.x, d.y);
  }

  private drawGround(): void {
    const b = this.track.bounds;
    const margin = 1400;
    const x0 = Math.floor((b.minX - margin) / 120) * 120;
    const x1 = b.maxX + margin;
    const y0 = Math.floor((b.minY - margin) / 120) * 120;
    const y1 = b.maxY + margin;
    const g = this.add(this.scene.add.graphics()).setDepth(DEPTH.grid);
    g.fillStyle(COLORS.background, 1);
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    // A quiet survey grid: just enough texture to read speed.
    for (let x = x0; x <= x1; x += 120) {
      const major = Math.round(x / 120) % 5 === 0;
      g.lineStyle(major ? 2 : 1, major ? COLORS.gridMajor : COLORS.grid, 1);
      g.lineBetween(x, y0, x, y1);
    }
    for (let y = y0; y <= y1; y += 120) {
      const major = Math.round(y / 120) % 5 === 0;
      g.lineStyle(major ? 2 : 1, major ? COLORS.gridMajor : COLORS.grid, 1);
      g.lineBetween(x0, y, x1, y);
    }
  }

  private drawRoad(): void {
    const t = this.track;
    const g = this.add(this.scene.add.graphics()).setDepth(DEPTH.road);
    g.fillStyle(COLORS.shoulder, 1);
    for (let i = 0; i < t.n; i++) this.quad(g, i, 1, CURB_WIDTH + 18, -1, CURB_WIDTH + 18);
    g.fillStyle(COLORS.road, 1);
    for (let i = 0; i < t.n; i++) this.quad(g, i, 1, 0, -1, 0);
    g.lineStyle(2, COLORS.roadLine, 1);
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
        g.fillStyle(0x000000, 0.45);
        for (let i = i0; i < i1; i++) this.quad(g, i, 1, 0, -1, 0);
        g.lineStyle(2, COLORS.white, 0.22);
        for (let i = i0 + 2; i < i1 - 1; i += 5) {
          const a = this.edge(i, 1);
          const b = this.edge(i, -1);
          g.lineBetween(a.x, a.y, b.x, b.y);
        }
      } else if (z.kind === 'split') {
        g.lineStyle(3, COLORS.white, 0.3);
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
        // Arena: burgundy hazard hatching along both edges.
        g.lineStyle(3, COLORS.burgundyHi, 0.55);
        for (let i = i0 + 4; i < i1 - 4; i += 3) {
          for (const side of [-1, 1]) {
            const a = this.edge(i, side, -2);
            const b = this.edge(i + 2, side, -16);
            g.lineBetween(a.x, a.y, b.x, b.y);
          }
        }
      }
    }
    for (const o of t.obstacles) {
      if (o.type === 'sweeper') {
        g.fillStyle(COLORS.burgundy, 0.18);
        g.fillCircle(o.cx, o.cy, o.arm + o.thickness);
        g.lineStyle(2, COLORS.burgundyHi, 0.7);
        g.strokeCircle(o.cx, o.cy, o.arm + o.thickness);
      }
    }
  }

  private drawPads(): void {
    for (const p of this.track.boostPads) {
      const g = this.add(this.scene.add.graphics()).setDepth(DEPTH.pads);
      const corner = (a: number, l: number): { x: number; y: number } => ({
        x: p.cx + p.tx * a + p.nx * l,
        y: p.cy + p.ty * a + p.ny * l,
      });
      const c1 = corner(-p.halfLength, -p.halfWidth);
      const c2 = corner(p.halfLength, -p.halfWidth);
      const c3 = corner(p.halfLength, p.halfWidth);
      const c4 = corner(-p.halfLength, p.halfWidth);
      g.fillStyle(COLORS.burgundy, 1);
      g.fillTriangle(c1.x, c1.y, c2.x, c2.y, c3.x, c3.y);
      g.fillTriangle(c1.x, c1.y, c3.x, c3.y, c4.x, c4.y);
      g.lineStyle(4, COLORS.white, 1);
      for (let k = 0; k < 3; k++) {
        const a = -p.halfLength + 18 + k * 26;
        const tip = corner(a + 12, 0);
        const l = corner(a - 4, -p.halfWidth + 6);
        const r = corner(a - 4, p.halfWidth - 6);
        g.strokePoints([l, tip, r], false);
      }
    }
  }

  private drawGates(): void {
    this.track.checkpoints.forEach((gate, k) => {
      const g = this.add(this.scene.add.graphics()).setDepth(DEPTH.gates);
      g.lineStyle(4, COLORS.checkpoint, 1);
      const segs = 9;
      for (let s = 0; s < segs; s += 2) {
        const u0 = s / segs;
        const u1 = (s + 1) / segs;
        g.lineBetween(
          gate.ax + (gate.bx - gate.ax) * u0,
          gate.ay + (gate.by - gate.ay) * u0,
          gate.ax + (gate.bx - gate.ax) * u1,
          gate.ay + (gate.by - gate.ay) * u1,
        );
      }
      const label = this.add(
        this.scene.add
          .text(gate.cx + gate.tx * 28, gate.cy + gate.ty * 28, `${k + 1}`, {
            fontFamily: '"Helvetica Neue", Arial, sans-serif',
            fontSize: '28px',
            fontStyle: '900',
            color: '#ffffff',
          })
          .setOrigin(0.5)
          .setResolution(Math.min(3, globalThis.devicePixelRatio || 1))
          .setDepth(DEPTH.gates),
      );
      this.gateViews.push({ gate, g, label });
    });
  }

  /** Alternating burgundy / white curb blocks just outside both road edges. */
  private drawCurbs(): void {
    const t = this.track;
    const g = this.add(this.scene.add.graphics()).setDepth(DEPTH.walls);
    for (const color of COLORS.sector) {
      g.fillStyle(color, 1);
      const offset = color === COLORS.sector[0] ? 0 : CURB_SAMPLES;
      for (let i = offset; i < t.n; i += CURB_SAMPLES * 2) {
        for (let k = 0; k < CURB_SAMPLES; k++) {
          for (const side of [1, -1]) this.quad(g, i + k, side, 0, side, CURB_WIDTH);
        }
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
    const p = (a: number, l: number): { x: number; y: number } => ({
      x: gate.cx + gate.tx * a + nx * l,
      y: gate.cy + gate.ty * a + ny * l,
    });
    for (let row = 0; row < 2; row++) {
      for (let c = 0; c < count; c++) {
        g.fillStyle((row + c) % 2 === 0 ? COLORS.white : 0x000000, 1);
        const l0 = -hw + c * size;
        const a0 = row * size - size;
        const q1 = p(a0, l0);
        const q2 = p(a0 + size, l0);
        const q3 = p(a0 + size, l0 + size);
        const q4 = p(a0, l0 + size);
        g.fillTriangle(q1.x, q1.y, q2.x, q2.y, q3.x, q3.y);
        g.fillTriangle(q1.x, q1.y, q3.x, q3.y, q4.x, q4.y);
      }
    }
    const sp = t.spawn;
    const ca = Math.cos(sp.angle);
    const sa = Math.sin(sp.angle);
    const box = (a: number, l: number): { x: number; y: number } => ({ x: sp.x + ca * a - sa * l, y: sp.y + sa * a + ca * l });
    g.lineStyle(2, COLORS.white, 0.5);
    g.strokePoints([box(-22, -16), box(20, -16), box(20, 16), box(-22, 16)], true);

    // Solid burgundy bar marking the finish once every checkpoint is cleared.
    const fg = this.add(this.scene.add.graphics()).setDepth(DEPTH.gates + 0.1);
    fg.lineStyle(8, COLORS.burgundyHi, 1);
    fg.lineBetween(gate.ax + gate.tx * 14, gate.ay + gate.ty * 14, gate.bx + gate.tx * 14, gate.by + gate.ty * 14);
    fg.setVisible(false);
    this.finishMark = fg;
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
        g.fillStyle(COLORS.hazardEdge, 1);
        this.capsule(g, o.ax, o.ay, o.bx, o.by, o.r + 2);
        g.fillStyle(COLORS.hazard, 1);
        this.capsule(g, o.ax, o.ay, o.bx, o.by, o.r);
      } else if (o.type === 'island') {
        const pts = o.points;
        g.fillStyle(COLORS.white, 1);
        for (let i = 0; i + 3 < pts.length; i += 2) {
          this.capsule(g, pts[i] as number, pts[i + 1] as number, pts[i + 2] as number, pts[i + 3] as number, o.r + 2);
        }
        g.fillStyle(0x000000, 1);
        for (let i = 0; i + 3 < pts.length; i += 2) {
          this.capsule(g, pts[i] as number, pts[i + 1] as number, pts[i + 2] as number, pts[i + 3] as number, o.r);
        }
      }
    }
  }

  /** Show the next gate in full, dim the rest; reveal the finish bar at the end. */
  setCheckpointState(next: number): void {
    this.gateViews.forEach((v, k) => {
      const alpha = k < next ? 0.12 : k === next ? 1 : 0.3;
      v.g.setAlpha(alpha);
      v.label.setAlpha(alpha);
    });
    this.finishMark?.setVisible(next >= this.gateViews.length);
  }

  /** Static art; kept for API symmetry with other renderers. */
  update(_visualMs: number, _wallMs: number): void {
    // Nothing animates: the track reads as printed asphalt.
  }

  destroy(): void {
    for (const o of this.objects) o.destroy();
    this.objects.length = 0;
    this.gateViews.length = 0;
    this.finishMark = null;
  }
}
