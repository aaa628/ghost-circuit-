/**
 * Deterministic pseudo-random numbers. Mulberry32 uses only 32-bit integer
 * math (Math.imul / >>>), so every JS engine produces the identical sequence
 * for the identical seed — the foundation of "everyone races the same track".
 */

/** FNV-1a 32-bit hash of a string, then avalanche-mixed. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Final avalanche (murmur3 fmix32) so similar dates diverge immediately.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Mulberry32 generator returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convenience wrapper with typed helpers. */
export class Rng {
  private readonly nextFloat: () => number;

  constructor(seed: number) {
    this.nextFloat = mulberry32(seed);
  }

  static fromString(key: string): Rng {
    return new Rng(hashString(key));
  }

  next(): number {
    return this.nextFloat();
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.nextFloat();
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.nextFloat() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.nextFloat() < p;
  }

  sign(): 1 | -1 {
    return this.nextFloat() < 0.5 ? -1 : 1;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick on empty array');
    const item = items[Math.floor(this.nextFloat() * items.length)];
    if (item === undefined) throw new Error('Rng.pick out of range');
    return item;
  }

  /** Fisher–Yates shuffle (returns a new array). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.nextFloat() * (i + 1));
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }
}
