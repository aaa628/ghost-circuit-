import { COLORS, GHOST_STYLE } from '../game/config';
import type { GhostDot } from '../game/scenes/RaceScene';
import type { Track } from '../game/track/TrackTypes';
import { h } from './dom';

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** Canvas minimap: the circuit drawn once, dots for the player and ghosts every frame. */
export class Minimap {
  readonly el: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private base: HTMLCanvasElement | null = null;
  private track: Track | null = null;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private readonly size: number;
  private readonly dpr: number;

  constructor(size = 120) {
    this.size = size;
    this.dpr = Math.min(3, globalThis.devicePixelRatio || 1);
    this.el = h('canvas', { class: 'minimap', width: size * this.dpr, height: size * this.dpr, 'aria-hidden': 'true' });
    this.el.style.width = `${size}px`;
    this.el.style.height = `${size}px`;
    this.ctx = this.el.getContext('2d');
  }

  setTrack(track: Track): void {
    this.track = track;
    const b = track.bounds;
    const pad = 8;
    const w = b.maxX - b.minX;
    const hgt = b.maxY - b.minY;
    this.scale = (this.size - pad * 2) / Math.max(w, hgt);
    this.ox = pad + (this.size - pad * 2 - w * this.scale) / 2 - b.minX * this.scale;
    this.oy = pad + (this.size - pad * 2 - hgt * this.scale) / 2 - b.minY * this.scale;
    const c = document.createElement('canvas');
    c.width = this.el.width;
    c.height = this.el.height;
    const g = c.getContext('2d');
    if (g) {
      g.scale(this.dpr, this.dpr);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      const bounds = [0, ...track.checkpoints.map((cp) => cp.index), track.n];
      for (let k = 0; k + 1 < bounds.length; k++) {
        g.strokeStyle = hex(COLORS.sector[k % COLORS.sector.length] as number);
        g.globalAlpha = 0.85;
        g.lineWidth = 3;
        g.beginPath();
        for (let i = bounds[k] as number; i <= (bounds[k + 1] as number); i++) {
          const j = i % track.n;
          const x = (track.xs[j] as number) * this.scale + this.ox;
          const y = (track.ys[j] as number) * this.scale + this.oy;
          if (i === bounds[k]) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
      g.globalAlpha = 1;
      g.fillStyle = '#ffffff';
      const sx = (track.xs[0] as number) * this.scale + this.ox;
      const sy = (track.ys[0] as number) * this.scale + this.oy;
      g.fillRect(sx - 2.5, sy - 2.5, 5, 5);
    }
    this.base = c;
  }

  draw(carX: number, carY: number, ghosts: readonly GhostDot[], nextCheckpoint: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.base || !this.track) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.el.width, this.el.height);
    ctx.drawImage(this.base, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const cp = this.track.checkpoints[nextCheckpoint] ?? this.track.startLine;
    ctx.fillStyle = '#7cf9ff';
    ctx.beginPath();
    ctx.arc(cp.cx * this.scale + this.ox, cp.cy * this.scale + this.oy, 3, 0, Math.PI * 2);
    ctx.fill();
    for (const g of ghosts) {
      ctx.fillStyle = GHOST_STYLE[g.slot].css;
      ctx.beginPath();
      ctx.arc(g.x * this.scale + this.ox, g.y * this.scale + this.oy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ff8a3d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(carX * this.scale + this.ox, carY * this.scale + this.oy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}
