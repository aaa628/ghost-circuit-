/**
 * Procedurally generated flat textures (Canvas 2D → Phaser). Nothing is loaded
 * from the network, so nothing can 404.
 */
import type Phaser from 'phaser';

export const TEX = {
  dot: 'gc-dot',
} as const;

function canvasTexture(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, w, h);
  draw(ctx);
  tex.refresh();
}

export function ensureTextures(scene: Phaser.Scene): void {
  // Flat disc for dust, smoke and debris particles (tinted per emitter).
  canvasTexture(scene, TEX.dot, 32, 32, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(16, 16, 15, 0, Math.PI * 2);
    ctx.fill();
  });
}
