/**
 * Procedurally generated flat textures (Canvas 2D → Phaser). Nothing is loaded
 * from the network, so nothing can 404.
 */
import type Phaser from 'phaser';

export const TEX = {
  car: 'gc-car',
  ghost: 'gc-ghost',
  dot: 'gc-dot',
} as const;

/** Texture pixels per world unit for car art (crisp when zoomed in). */
export const CAR_TEX_SCALE = 3;

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

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Flat car silhouette facing +x. Body is 34×18 world units. */
function drawCar(ctx: CanvasRenderingContext2D, ghost: boolean): void {
  const S = CAR_TEX_SCALE;
  ctx.save();
  ctx.translate(26 * S, 15 * S);
  ctx.scale(S, S);
  ctx.beginPath();
  ctx.moveTo(-17, -8);
  ctx.lineTo(9, -9);
  ctx.quadraticCurveTo(17, -6, 18, 0);
  ctx.quadraticCurveTo(17, 6, 9, 9);
  ctx.lineTo(-17, 8);
  ctx.quadraticCurveTo(-19, 0, -17, -8);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = ghost ? '#ffffff' : '#000000';
  ctx.stroke();
  if (!ghost) {
    // Burgundy livery: center stripe and rear wing.
    ctx.fillStyle = '#6d001a';
    ctx.fillRect(-17, -2, 33, 4);
  }
  ctx.fillStyle = ghost ? 'rgba(0,0,0,0.55)' : '#0a0a0a';
  roundedRect(ctx, -6, -5.5, 12, 11, 3);
  ctx.fill();
  ctx.fillStyle = ghost ? 'rgba(0,0,0,0.8)' : '#6d001a';
  ctx.fillRect(-19, -9, 3, 18);
  ctx.restore();
}

export function ensureTextures(scene: Phaser.Scene): void {
  const S = CAR_TEX_SCALE;
  canvasTexture(scene, TEX.car, 46 * S, 30 * S, (ctx) => drawCar(ctx, false));
  canvasTexture(scene, TEX.ghost, 46 * S, 30 * S, (ctx) => drawCar(ctx, true));
  // Flat disc for dust, smoke and debris particles (tinted per emitter).
  canvasTexture(scene, TEX.dot, 32, 32, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(16, 16, 15, 0, Math.PI * 2);
    ctx.fill();
  });
}
