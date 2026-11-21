/**
 * Compact binary ghost format (v1), base64url encoded.
 *
 *   u8      version (1)
 *   varint  frame count
 *   frame 0 : varint t, zigzag x, zigzag y, zigzag r, u8 boost
 *   frame k : varint (dt << 1 | boost), zigzag dx, zigzag dy, zigzag dr (mod 629)
 *
 * Values are pre-quantized integers: t in ms, x/y in 0.1 units, r in 0.01 rad
 * (range -314..314). A typical 25s lap (≈750 frames) is ~6 KB of text.
 */
import { GHOST } from '../config';

export type GhostFrames = {
  count: number;
  /** Race-clock time, integer ms, strictly increasing. */
  t: Int32Array;
  /** Position ×10 (0.1 unit precision). */
  x: Int32Array;
  y: Int32Array;
  /** Heading ×100 (0.01 rad), within -314..314. */
  r: Int16Array;
  /** 1 while boosting. */
  b: Uint8Array;
};

const VERSION = 1;
const ROT_MOD = 629; // residues -314..314
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) table[B64.charCodeAt(i)] = i;
  return table;
})();

export function allocFrames(capacity: number): GhostFrames {
  return {
    count: 0,
    t: new Int32Array(capacity),
    x: new Int32Array(capacity),
    y: new Int32Array(capacity),
    r: new Int16Array(capacity),
    b: new Uint8Array(capacity),
  };
}

const zigzag = (n: number): number => ((n << 1) ^ (n >> 31)) >>> 0;
const unzigzag = (n: number): number => (n >>> 1) ^ -(n & 1);

function wrapRot(v: number): number {
  let r = (v + 314) % ROT_MOD;
  if (r < 0) r += ROT_MOD;
  return r - 314;
}

class ByteWriter {
  private buf = new Uint8Array(4096);
  length = 0;

  private ensure(extra: number): void {
    if (this.length + extra <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.length + extra));
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }

  u8(v: number): void {
    this.ensure(1);
    this.buf[this.length++] = v & 0xff;
  }

  varint(v: number): void {
    let n = v >>> 0;
    this.ensure(5);
    while (n >= 0x80) {
      this.buf[this.length++] = (n & 0x7f) | 0x80;
      n >>>= 7;
    }
    this.buf[this.length++] = n;
  }

  bytes(): Uint8Array {
    return this.buf.subarray(0, this.length);
  }
}

class ByteReader {
  pos = 0;
  constructor(private readonly buf: Uint8Array) {}

  get done(): boolean {
    return this.pos >= this.buf.length;
  }

  u8(): number {
    if (this.pos >= this.buf.length) throw new RangeError('ghost: truncated');
    return this.buf[this.pos++] as number;
  }

  varint(): number {
    let result = 0;
    let shift = 0;
    for (let i = 0; i < 5; i++) {
      const byte = this.u8();
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result >>> 0;
      shift += 7;
    }
    throw new RangeError('ghost: varint too long');
  }
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = (bytes[i] as number) << 16;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
  } else if (rem === 2) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]!;
  }
  return out;
}

export function base64UrlDecode(text: string): Uint8Array | null {
  const len = text.length;
  if (len % 4 === 1) return null;
  const outLen = Math.floor((len * 3) / 4);
  const out = new Uint8Array(outLen);
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < len; i++) {
    const code = text.charCodeAt(i);
    const v = code < 128 ? (B64_LOOKUP[code] as number) : -1;
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

export function encodeGhost(frames: GhostFrames): string {
  const w = new ByteWriter();
  w.u8(VERSION);
  w.varint(frames.count);
  for (let i = 0; i < frames.count; i++) {
    const t = frames.t[i] as number;
    const x = frames.x[i] as number;
    const y = frames.y[i] as number;
    const r = frames.r[i] as number;
    const b = (frames.b[i] as number) ? 1 : 0;
    if (i === 0) {
      w.varint(t);
      w.varint(zigzag(x));
      w.varint(zigzag(y));
      w.varint(zigzag(r));
      w.u8(b);
    } else {
      const dt = t - (frames.t[i - 1] as number);
      w.varint(((dt << 1) | b) >>> 0);
      w.varint(zigzag(x - (frames.x[i - 1] as number)));
      w.varint(zigzag(y - (frames.y[i - 1] as number)));
      w.varint(zigzag(wrapRot(r - (frames.r[i - 1] as number))));
    }
  }
  return base64UrlEncode(w.bytes());
}

/** Decode a ghost string. Returns null for any malformed or oversized input. */
export function decodeGhost(text: unknown): GhostFrames | null {
  if (typeof text !== 'string' || text.length < 4 || text.length > GHOST.MAX_ENCODED_LENGTH) return null;
  const bytes = base64UrlDecode(text);
  if (!bytes) return null;
  try {
    const r = new ByteReader(bytes);
    if (r.u8() !== VERSION) return null;
    const count = r.varint();
    if (count < 2 || count > GHOST.MAX_FRAMES) return null;
    const f = allocFrames(count);
    let t = r.varint();
    let x = unzigzag(r.varint());
    let y = unzigzag(r.varint());
    let rot = unzigzag(r.varint());
    let b = r.u8() ? 1 : 0;
    if (rot < -314 || rot > 314) return null;
    f.t[0] = t;
    f.x[0] = x;
    f.y[0] = y;
    f.r[0] = rot;
    f.b[0] = b;
    for (let i = 1; i < count; i++) {
      const head = r.varint();
      b = head & 1;
      t += head >>> 1;
      x += unzigzag(r.varint());
      y += unzigzag(r.varint());
      rot = wrapRot(rot + unzigzag(r.varint()));
      if (t > 10_000_000 || Math.abs(x) > 50_000_000 || Math.abs(y) > 50_000_000) return null;
      f.t[i] = t;
      f.x[i] = x;
      f.y[i] = y;
      f.r[i] = rot;
      f.b[i] = b;
    }
    if (!r.done) return null;
    f.count = count;
    return f;
  } catch {
    return null;
  }
}

/** World-space accessors for a quantized frame. */
export const frameX = (f: GhostFrames, i: number): number => (f.x[i] as number) / GHOST.POS_SCALE;
export const frameY = (f: GhostFrames, i: number): number => (f.y[i] as number) / GHOST.POS_SCALE;
export const frameR = (f: GhostFrames, i: number): number => (f.r[i] as number) / GHOST.ROT_SCALE;
