/**
 * Procedural art for the main menu: chunky pixel lettering, 1-bit dither
 * textures, torn-paper edges and a halftone print of the 3D car. Everything
 * is generated at runtime with Canvas 2D (no images, no web fonts).
 */
import { GHOST_PALETTE, renderCarCanvas } from '../game/render/CarModel';

/**
 * Render text into a canvas at a tiny size and hard-threshold the alpha, so
 * scaling it up with `image-rendering: pixelated` gives crisp bitmap letters.
 */
export function pixelText(text: string, opts: { px: number; color: string; weight?: number }): HTMLCanvasElement {
  const font = `${opts.weight ?? 900} ${opts.px}px "Helvetica Neue", Arial, sans-serif`;
  const measure = document.createElement('canvas').getContext('2d');
  if (measure) measure.font = font;
  const w = Math.ceil((measure?.measureText(text).width ?? text.length * opts.px * 0.6) + 2);
  const h = Math.ceil(opts.px * 1.2);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = opts.color;
  ctx.fillText(text, 1, h / 2 + 1);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = (d[i] as number) > 110 ? 255 : 0;
  ctx.putImageData(img, 0, 0);
  c.classList.add('pixel');
  return c;
}

/** Ordered (Bayer 4×4) dither tile as a CSS url(): `density` 0..1 of `fg` pixels over `bg`. */
export function ditherTile(fg: string, bg: string, density: number, pixel = 2): string {
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const c = document.createElement('canvas');
  c.width = 4 * pixel;
  c.height = 4 * pixel;
  const ctx = c.getContext('2d');
  if (!ctx) return 'none';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = fg;
  for (let i = 0; i < 16; i++) {
    if (((bayer[i] as number) + 0.5) / 16 < density) ctx.fillRect((i % 4) * pixel, Math.floor(i / 4) * pixel, pixel, pixel);
  }
  return `url("${c.toDataURL()}")`;
}

/**
 * Jagged polygon for a horizontal paper strip (0–100% box), as a CSS
 * clip-path. Seeded so the tear looks the same on every load.
 */
export function tornStrip(seed: number, jag = 7, teeth = 46): string {
  let s = seed >>> 0;
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i <= teeth; i++) {
    const x = (i / teeth) * 100;
    top.push(`${x.toFixed(2)}% ${(rnd() * jag).toFixed(2)}%`);
    bottom.push(`${x.toFixed(2)}% ${(100 - rnd() * jag).toFixed(2)}%`);
  }
  return `polygon(${[...top, ...bottom.reverse()].join(', ')})`;
}

/**
 * Halftone print of the car: luminance sampled on a grid and redrawn as dots
 * (bigger = brighter), with the burgundy livery kept in burgundy.
 */
export function halftoneCar(sizePx: number, heading: number, cell = 7): HTMLCanvasElement {
  const src = renderCarCanvas(heading, { ...GHOST_PALETTE, accent: '#9e1030', tail: '#9e1030', glass: '#4a4a4a' }, sizePx / 60);
  const sctx = src.getContext('2d');
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d');
  if (!sctx || !ctx) return out;
  const data = sctx.getImageData(0, 0, src.width, src.height).data;
  for (let y = cell / 2; y < src.height; y += cell) {
    for (let x = cell / 2; x < src.width; x += cell) {
      const i = (Math.floor(y) * src.width + Math.floor(x)) * 4;
      const a = (data[i + 3] as number) / 255;
      if (a < 0.4) continue;
      const r = data[i] as number;
      const g = data[i + 1] as number;
      const b = data[i + 2] as number;
      const lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
      const red = r > g + 50;
      const radius = (cell / 2) * (red ? 0.9 : 0.25 + 0.75 * lum);
      ctx.fillStyle = red ? '#9e1030' : lum > 0.75 ? '#e8e8e8' : '#8a8a8a';
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return out;
}
