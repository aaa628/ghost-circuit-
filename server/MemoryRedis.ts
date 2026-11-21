/**
 * Tiny in-memory Redis implementing the `RedisLike` subset used by RunStore,
 * with key expiry and optional JSON-file persistence. Lets the standalone
 * server run with zero external services while exercising the exact same
 * storage code path as Devvit Redis.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RedisLike, ZMember } from './RunStore';

type Value =
  | { kind: 'str'; v: string }
  | { kind: 'hash'; v: Record<string, string> }
  | { kind: 'zset'; v: Record<string, number> };

type Entry = { value: Value; expiresAt: number | null };

type Snapshot = Record<string, Entry>;

export class MemoryRedis implements RedisLike {
  private data = new Map<string, Entry>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly file: string | null = null) {
    if (file && existsSync(file)) {
      try {
        const snap = JSON.parse(readFileSync(file, 'utf8')) as Snapshot;
        for (const [k, e] of Object.entries(snap)) this.data.set(k, e);
      } catch (err) {
        console.warn(`[MemoryRedis] could not read ${file}, starting empty:`, err);
      }
    }
  }

  private live(key: string): Entry | undefined {
    const e = this.data.get(key);
    if (!e) return undefined;
    if (e.expiresAt !== null && e.expiresAt <= Date.now()) {
      this.data.delete(key);
      return undefined;
    }
    return e;
  }

  private persist(): void {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 250);
  }

  /** Write the snapshot to disk now (atomic rename). */
  flush(): void {
    if (!this.file) return;
    const snap: Snapshot = {};
    for (const [k, e] of this.data) {
      if (e.expiresAt === null || e.expiresAt > Date.now()) snap[k] = e;
    }
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(snap));
    renameSync(tmp, this.file);
  }

  private hash(key: string, create: boolean): Record<string, string> | null {
    const e = this.live(key);
    if (e) {
      if (e.value.kind !== 'hash') throw new Error('WRONGTYPE');
      return e.value.v;
    }
    if (!create) return null;
    const v: Record<string, string> = {};
    this.data.set(key, { value: { kind: 'hash', v }, expiresAt: null });
    return v;
  }

  private zset(key: string, create: boolean): Record<string, number> | null {
    const e = this.live(key);
    if (e) {
      if (e.value.kind !== 'zset') throw new Error('WRONGTYPE');
      return e.value.v;
    }
    if (!create) return null;
    const v: Record<string, number> = {};
    this.data.set(key, { value: { kind: 'zset', v }, expiresAt: null });
    return v;
  }

  private sorted(key: string): ZMember[] {
    const z = this.zset(key, false);
    if (!z) return [];
    return Object.entries(z)
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => a.score - b.score || (a.member < b.member ? -1 : a.member > b.member ? 1 : 0));
  }

  async get(key: string): Promise<string | undefined> {
    const e = this.live(key);
    if (!e) return undefined;
    if (e.value.kind !== 'str') throw new Error('WRONGTYPE');
    return e.value.v;
  }

  async set(key: string, value: string, options?: { nx?: boolean; expiration?: Date }): Promise<string> {
    if (options?.nx && this.live(key)) return '';
    this.data.set(key, {
      value: { kind: 'str', v: value },
      expiresAt: options?.expiration ? options.expiration.getTime() : null,
    });
    this.persist();
    return 'OK';
  }

  async del(...keys: string[]): Promise<void> {
    for (const k of keys) this.data.delete(k);
    this.persist();
  }

  async expire(key: string, seconds: number): Promise<void> {
    const e = this.live(key);
    if (e) {
      e.expiresAt = Date.now() + seconds * 1000;
      this.persist();
    }
  }

  async incrBy(key: string, value: number): Promise<number> {
    const cur = Number((await this.get(key)) ?? '0');
    const next = (Number.isFinite(cur) ? cur : 0) + value;
    const e = this.live(key);
    this.data.set(key, { value: { kind: 'str', v: String(next) }, expiresAt: e?.expiresAt ?? null });
    this.persist();
    return next;
  }

  async zAdd(key: string, ...members: ZMember[]): Promise<number> {
    const z = this.zset(key, true) as Record<string, number>;
    let added = 0;
    for (const m of members) {
      if (!(m.member in z)) added++;
      z[m.member] = m.score;
    }
    this.persist();
    return added;
  }

  async zRange(
    key: string,
    start: number | string,
    stop: number | string,
    options?: { by: 'score' | 'lex' | 'rank'; reverse?: boolean; limit?: { offset: number; count: number } },
  ): Promise<ZMember[]> {
    let list = this.sorted(key);
    if (options?.reverse) list = list.reverse();
    const by = options?.by ?? 'rank';
    if (by === 'rank') {
      const n = list.length;
      let a = Number(start);
      let b = Number(stop);
      if (a < 0) a = n + a;
      if (b < 0) b = n + b;
      a = Math.max(0, a);
      b = Math.min(n - 1, b);
      return a > b ? [] : list.slice(a, b + 1);
    }
    if (by === 'score') {
      const lo = start === '-inf' ? -Infinity : Number(start);
      const hi = stop === '+inf' ? Infinity : Number(stop);
      let out = list.filter((m) => m.score >= Math.min(lo, hi) && m.score <= Math.max(lo, hi));
      if (options?.limit) out = out.slice(options.limit.offset, options.limit.offset + options.limit.count);
      return out;
    }
    throw new Error('MemoryRedis: lex ranges are not supported');
  }

  async zRank(key: string, member: string): Promise<number | undefined> {
    const i = this.sorted(key).findIndex((m) => m.member === member);
    return i < 0 ? undefined : i;
  }

  async zScore(key: string, member: string): Promise<number | undefined> {
    const z = this.zset(key, false);
    return z && member in z ? z[member] : undefined;
  }

  async zCard(key: string): Promise<number> {
    const z = this.zset(key, false);
    return z ? Object.keys(z).length : 0;
  }

  async hGet(key: string, field: string): Promise<string | undefined> {
    const h = this.hash(key, false);
    return h && field in h ? h[field] : undefined;
  }

  async hSet(key: string, fieldValues: Record<string, string>): Promise<number> {
    const h = this.hash(key, true) as Record<string, string>;
    let added = 0;
    for (const [f, v] of Object.entries(fieldValues)) {
      if (!(f in h)) added++;
      h[f] = v;
    }
    this.persist();
    return added;
  }

  async hMGet(key: string, fields: string[]): Promise<(string | null)[]> {
    const h = this.hash(key, false);
    return fields.map((f) => (h && f in h ? (h[f] as string) : null));
  }
}
