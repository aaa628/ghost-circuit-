/**
 * Lightweight Canvas-2D preview of a circuit for the feed splash: flat walls,
 * start line, checkpoints, and up to two ghost dots looping their laps.
 * No Phaser here — the inline view must stay fast.
 */
import { COLORS } from '../game/config';
import type { GhostTimeline, GhostPose } from '../game/ghost/GhostTimeline';
import type { Track } from '../game/track/TrackTypes';

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

export type PreviewGhost = { timeline: GhostTimeline; color: string };

export class TrackPreview {
  private readonly ctx: CanvasRenderingContext2D | null;
  private base: HTMLCanvasElement | null = null;
  private track: Track | null = null;
  private ghosts: PreviewGhost[] = [];
  private raf = 0;
  private start = 0;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private readonly pose: GhostPose = { x: 0, y: 0, r: 0, boosting: false, finished: false };
  private readonly onResize: () => void;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
    this.onResize = () => this.layout();
    window.addEventListener('resize', this.onResize);
  }

  setTrack(track: Track): void {
    this.track = track;
    this.layout();
  }

  setGhosts(ghosts: PreviewGhost[]): void {
    this.ghosts = ghosts;
    this.start = performance.now();
    if (!this.raf) this.loop();
  }

  private layout(): void {
    const track = this.track;
    if (!track || !this.ctx) return;
    const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    const b = track.bounds;
    const pad = 10;
    // Leave room at the top for the circuit name overlay.
    const top = Math.min(78, h * 0.3);
    const bw = b.maxX - b.minX;
    const bh = b.maxY - b.minY;
    this.scale = Math.min((w - pad * 2) / bw, (h - top - pad) / bh);
    this.ox = (w - bw * this.scale) / 2 - b.minX * this.scale;
    this.oy = top + (h - top - pad - bh * this.scale) / 2 - b.minY * this.scale;

    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const g = c.getContext('2d');
    if (g) {
      g.scale(dpr, dpr);
      g.lineJoin = 'round';
      g.lineCap = 'round';
      const X = (i: number, side: number): number =>
        ((track.xs[i] as number) + (track.nx[i] as number) * (track.hw[i] as number) * side) * this.scale + this.ox;
      const Y = (i: number, side: number): number =>
        ((track.ys[i] as number) + (track.ny[i] as number) * (track.hw[i] as number) * side) * this.scale + this.oy;
      // Road.
      g.fillStyle = hex(COLORS.road);
      g.beginPath();
      for (let i = 0; i <= track.n; i++) {
        const k = i % track.n;
        if (i === 0) g.moveTo(X(k, 1), Y(k, 1));
        else g.lineTo(X(k, 1), Y(k, 1));
      }
      for (let i = track.n; i >= 0; i--) {
        const k = i % track.n;
        g.lineTo(X(k, -1), Y(k, -1));
      }
      g.closePath();
      g.fill('evenodd');
      // Walls per sector with glow.
      const bounds = [0, ...track.checkpoints.map((cp) => cp.index), track.n];
      for (let s = 0; s + 1 < bounds.length; s++) {
        const color = hex(COLORS.sector[s % COLORS.sector.length] as number);
        for (const side of [1, -1]) {
          g.beginPath();
          for (let i = bounds[s] as number; i <= (bounds[s + 1] as number); i++) {
            const k = i % track.n;
            if (i === bounds[s]) g.moveTo(X(k, side), Y(k, side));
            else g.lineTo(X(k, side), Y(k, side));
          }
          g.strokeStyle = color;
          g.lineWidth = 1.6;
          g.stroke();
        }
      }
      // Start line + checkpoints.
      const line = (ax: number, ay: number, bx: number, by: number, color: string, width: number): void => {
        g.strokeStyle = color;
        g.lineWidth = width;
        g.beginPath();
        g.moveTo(ax * this.scale + this.ox, ay * this.scale + this.oy);
        g.lineTo(bx * this.scale + this.ox, by * this.scale + this.oy);
        g.stroke();
      };
      for (const cp of track.checkpoints) line(cp.ax, cp.ay, cp.bx, cp.by, 'rgba(255,255,255,0.4)', 1.2);
      const sl = track.startLine;
      line(sl.ax, sl.ay, sl.bx, sl.by, '#ffffff', 2.5);
      // Hazards as small dots.
      g.fillStyle = hex(COLORS.burgundyHi);
      for (const o of track.obstacles) {
        if (o.type === 'island') continue;
        const x = o.type === 'fin' ? o.bx : o.cx;
        const y = o.type === 'fin' ? o.by : o.cy;
        g.beginPath();
        g.arc(x * this.scale + this.ox, y * this.scale + this.oy, 2.2, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = hex(COLORS.white);
      for (const p of track.boostPads) {
        g.beginPath();
        g.arc(p.cx * this.scale + this.ox, p.cy * this.scale + this.oy, 2.2, 0, Math.PI * 2);
        g.fill();
      }
    }
    this.base = c;
    this.draw(performance.now());
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden) return;
    this.draw(performance.now());
  };

  private draw(now: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.base) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, 0, 0);
    const dpr = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const g of this.ghosts) {
      const lap = g.timeline.finishMs + 900;
      const t = (now - this.start) % lap;
      const p = g.timeline.sample(Math.min(t, g.timeline.finishMs), this.pose);
      const x = p.x * this.scale + this.ox;
      const y = p.y * this.scale + this.oy;
      ctx.fillStyle = g.color;
      ctx.strokeStyle = '#0a0a0a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.removeEventListener('resize', this.onResize);
  }
}
