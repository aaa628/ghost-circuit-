/**
 * Renders one translucent, non-colliding ghost car (sprite + fading trail +
 * floating name tag) from a GhostTimeline at the live race clock.
 */
import Phaser from 'phaser';
import { GHOST, GHOST_STYLE, type GhostSlot } from '../config';
import { CAR_TEX_SCALE, TEX } from '../render/Textures';
import type { GhostPose, GhostTimeline } from './GhostTimeline';

export class GhostPlayer {
  timeline: GhostTimeline | null = null;
  label = '';
  private visible = true;
  private readonly sprite: Phaser.GameObjects.Image;
  private readonly glow: Phaser.GameObjects.Image;
  private readonly trail: Phaser.GameObjects.Graphics;
  private readonly tag: Phaser.GameObjects.Text;
  private readonly pose: GhostPose = { x: 0, y: 0, r: 0, boosting: false, finished: false };
  private readonly color: number;

  constructor(scene: Phaser.Scene, readonly slot: GhostSlot) {
    const style = GHOST_STYLE[slot];
    this.color = style.color;
    this.trail = scene.add.graphics().setDepth(8).setBlendMode(Phaser.BlendModes.ADD);
    this.glow = scene.add
      .image(0, 0, TEX.glow)
      .setDepth(8.5)
      .setTint(style.color)
      .setAlpha(0.35)
      .setScale(0.9)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.sprite = scene.add
      .image(0, 0, TEX.ghost)
      .setOrigin(26 / 46, 0.5)
      .setScale(1 / CAR_TEX_SCALE)
      .setTint(style.color)
      .setAlpha(GHOST.ALPHA)
      .setDepth(9);
    this.tag = scene.add
      .text(0, 0, '', {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: '13px',
        fontStyle: 'bold',
        color: style.css,
        backgroundColor: 'rgba(5,6,15,0.72)',
        padding: { x: 5, y: 2 },
      })
      .setOrigin(0.5, 1)
      .setDepth(12)
      .setResolution(Math.min(3, globalThis.devicePixelRatio || 1));
    this.applyVisibility();
  }

  set(timeline: GhostTimeline | null, label: string): void {
    this.timeline = timeline;
    this.label = label;
    this.tag.setText(label);
    this.applyVisibility();
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.applyVisibility();
  }

  get active(): boolean {
    return this.timeline !== null;
  }

  /** Last rendered position (for the minimap). */
  get x(): number {
    return this.pose.x;
  }

  get y(): number {
    return this.pose.y;
  }

  get shown(): boolean {
    return this.visible && this.timeline !== null;
  }

  private applyVisibility(): void {
    const on = this.shown;
    this.sprite.setVisible(on);
    this.glow.setVisible(on);
    this.trail.setVisible(on);
    this.tag.setVisible(on);
  }

  update(tMs: number, zoom: number): void {
    const tl = this.timeline;
    if (!tl || !this.visible) return;
    const p = tl.sample(tMs, this.pose);
    this.sprite.setPosition(p.x, p.y).setRotation(p.r);
    this.sprite.setAlpha(p.finished ? GHOST.ALPHA * 0.55 : GHOST.ALPHA);
    this.glow.setPosition(p.x, p.y).setAlpha(p.boosting ? 0.6 : 0.3);
    const inv = 1 / Math.max(0.3, zoom);
    this.tag.setPosition(p.x, p.y - 22 * Math.min(1.6, inv)).setScale(inv);

    // Trail through the last few recorded frames.
    const g = this.trail;
    g.clear();
    const k = tl.trailIndex(tMs);
    const start = Math.max(0, k - GHOST.TRAIL_FRAMES);
    let px = p.x;
    let py = p.y;
    for (let i = k; i >= start; i--) {
      const x = tl.x[i] as number;
      const y = tl.y[i] as number;
      const age = (k - i) / GHOST.TRAIL_FRAMES;
      g.lineStyle(7 * (1 - age) + 1, this.color, 0.32 * (1 - age));
      g.lineBetween(px, py, x, y);
      px = x;
      py = y;
    }
  }

  destroy(): void {
    this.sprite.destroy();
    this.glow.destroy();
    this.trail.destroy();
    this.tag.destroy();
  }
}
