/**
 * Renders one translucent, non-colliding ghost car (sprite + fading trail +
 * floating name tag) from a GhostTimeline at the live race clock.
 */
import Phaser from 'phaser';
import { GHOST, GHOST_STYLE, type GhostSlot } from '../config';
import { CAR_ORIGIN, CAR_DISPLAY_SCALE, carFrameFor } from '../render/CarModel';
import type { GhostPose, GhostTimeline } from './GhostTimeline';

export class GhostPlayer {
  timeline: GhostTimeline | null = null;
  label = '';
  private visible = true;
  private readonly sprite: Phaser.GameObjects.Image;
  private readonly trail: Phaser.GameObjects.Graphics;
  private readonly tag: Phaser.GameObjects.Text;
  private readonly pose: GhostPose = { x: 0, y: 0, r: 0, boosting: false, finished: false };
  private readonly color: number;

  constructor(scene: Phaser.Scene, readonly slot: GhostSlot) {
    const style = GHOST_STYLE[slot];
    this.color = style.color;
    this.trail = scene.add.graphics().setDepth(8);
    this.sprite = scene.add
      .image(0, 0, 'gc-ghost-3d', 0)
      .setOrigin(CAR_ORIGIN.x, CAR_ORIGIN.y)
      .setScale(CAR_DISPLAY_SCALE)
      .setTint(style.color)
      .setAlpha(GHOST.ALPHA)
      .setDepth(9);
    this.tag = scene.add
      .text(0, 0, '', {
        fontFamily: '"Helvetica Neue", Arial, sans-serif',
        fontSize: '12px',
        fontStyle: '800',
        color: slot === 'record' ? '#ffffff' : '#000000',
        backgroundColor: style.css,
        padding: { x: 6, y: 3 },
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
    this.trail.setVisible(on);
    this.tag.setVisible(on);
  }

  update(tMs: number, zoom: number): void {
    const tl = this.timeline;
    if (!tl || !this.visible) return;
    const p = tl.sample(tMs, this.pose);
    this.sprite.setPosition(p.x, p.y).setFrame(carFrameFor(p.r));
    this.sprite.setAlpha(p.finished ? GHOST.ALPHA * 0.55 : GHOST.ALPHA);
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
      g.lineStyle(4 * (1 - age) + 1, this.color, 0.28 * (1 - age));
      g.lineBetween(px, py, x, y);
      px = x;
      py = y;
    }
  }

  destroy(): void {
    this.sprite.destroy();
    this.trail.destroy();
    this.tag.destroy();
  }
}
