/**
 * Procedurally generated textures (Canvas 2D → Phaser). Nothing is loaded
 * from the network, so nothing can 404.
 */
import type Phaser from 'phaser';

export const TEX = {
  car: 'gc-car',
  ghost: 'gc-ghost',
  dot: 'gc-dot',
  glow: 'gc-glow',
  streak: 'gc-streak',
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

/** Car silhouette facing +x. Body is 34×18 world units. */
function drawCar(ctx: CanvasRenderingContext2D, ghost: boolean): void {
  const S = CAR_TEX_SCALE;
  const cx = 26 * S;
  const cy = 15 * S;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(S, S);
  // Body (wedge nose).
  ctx.beginPath();
  ctx.moveTo(-17, -8);
  ctx.lineTo(9, -9);
  ctx.quadraticCurveTo(17, -6, 18, 0);
  ctx.quadraticCurveTo(17, 6, 9, 9);
  ctx.lineTo(-17, 8);
  ctx.quadraticCurveTo(-19, 0, -17, -8);
  ctx.closePath();
  if (ghost) {
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 6;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  } else {
    ctx.shadowColor = '#ff8a3d';
    ctx.shadowBlur = 8;
    const grad = ctx.createLinearGradient(-17, -9, -17, 9);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.5, '#ffe3cf');
    grad.addColorStop(1, '#ffb27a');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#ff8a3d';
    ctx.stroke();
    // Racing stripe.
    ctx.fillStyle = '#ff4d6d';
    ctx.fillRect(-16, -1.6, 30, 3.2);
  }
  // Cockpit.
  ctx.fillStyle = ghost ? 'rgba(10,12,30,0.55)' : '#141833';
  roundedRect(ctx, -6, -5.5, 12, 11, 4);
  ctx.fill();
  ctx.fillStyle = ghost ? 'rgba(255,255,255,0.35)' : 'rgba(140,220,255,0.65)';
  roundedRect(ctx, 0, -4.2, 5, 8.4, 2.5);
  ctx.fill();
  // Rear wing + tail lights.
  ctx.fillStyle = ghost ? 'rgba(255,255,255,0.8)' : '#ff3d5a';
  ctx.fillRect(-19, -9, 3, 18);
  // Headlights.
  ctx.fillStyle = ghost ? 'rgba(255,255,255,0.9)' : '#fff6c2';
  ctx.beginPath();
  ctx.arc(15, -4.5, 1.6, 0, Math.PI * 2);
  ctx.arc(15, 4.5, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function ensureTextures(scene: Phaser.Scene): void {
  const S = CAR_TEX_SCALE;
  canvasTexture(scene, TEX.car, 46 * S, 30 * S, (ctx) => drawCar(ctx, false));
  canvasTexture(scene, TEX.ghost, 46 * S, 30 * S, (ctx) => drawCar(ctx, true));
  canvasTexture(scene, TEX.dot, 32, 32, (ctx) => {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
  });
  canvasTexture(scene, TEX.glow, 128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
  canvasTexture(scene, TEX.streak, 32, 8, (ctx) => {
    const g = ctx.createLinearGradient(0, 4, 32, 4);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = g;
    roundedRect(ctx, 0, 1, 32, 6, 3);
    ctx.fill();
  });
}
