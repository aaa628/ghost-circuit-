/**
 * Leaderboard + ghost storage on top of a minimal Redis interface.
 *
 * `RedisLike` is a structural subset of Devvit's `redis` client, so in
 * production this class receives `redis` from `@devvit/web/server` directly;
 * locally it receives the in-memory `MemoryRedis` (same semantics).
 *
 * Keys (all prefixed `gc:v2:`). `{date}` is a circuit key: a UTC date for the
 * daily circuit, or a permanent circuit id (`perm-*`) whose board never expires.
 *   lb:{date}      ZSET  username → best timeMs (ascending = faster)
 *   best:{date}    HASH  username → runId of that best
 *   run:{id}       STR   RunRecord JSON (with ghost), TTL 45d (daily best) / none
 *                        (all-time best) / 10d (shared or superseded)
 *   post:{date}    STR   Reddit post id of the daily post
 *   post:latest    STR   JSON { date, postId }
 *   rl:{user}      STR   submission rate-limit token (short TTL)
 */
import {
  newRunId,
  type LeaderboardEntry,
  type LeaderboardResponse,
  type PersonalStanding,
  type RunRecord,
  type RunSummary,
} from '../src/shared/api';
import { isPermanent } from '../src/game/track/Circuits';

export type ZMember = { member: string; score: number };

export type RedisLike = {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, options?: { nx?: boolean; expiration?: Date }): Promise<string>;
  del(...keys: string[]): Promise<void>;
  expire(key: string, seconds: number): Promise<void>;
  incrBy(key: string, value: number): Promise<number>;
  zAdd(key: string, ...members: ZMember[]): Promise<number>;
  zRange(
    key: string,
    start: number | string,
    stop: number | string,
    options?: { by: 'score' | 'lex' | 'rank'; reverse?: boolean; limit?: { offset: number; count: number } },
  ): Promise<{ member: string; score: number }[]>;
  zRank(key: string, member: string): Promise<number | undefined>;
  zScore(key: string, member: string): Promise<number | undefined>;
  zCard(key: string): Promise<number>;
  hGet(key: string, field: string): Promise<string | undefined>;
  hSet(key: string, fieldValues: Record<string, string>): Promise<number>;
  hMGet(key: string, fields: string[]): Promise<(string | null)[]>;
};

const P = 'gc:v2:';
const DAY_S = 86_400;
const BEST_TTL_S = 45 * DAY_S;
const SHARED_TTL_S = 10 * DAY_S;

export type SubmitOutcome = {
  run: RunSummary;
  isPersonalBest: boolean;
  isRecord: boolean;
  previousBestMs: number | null;
};

const summarize = (r: RunRecord): RunSummary => ({
  id: r.id,
  username: r.username,
  dateKey: r.dateKey,
  timeMs: r.timeMs,
  createdAt: r.createdAt,
});

function parseRun(raw: string | undefined): RunRecord | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (
      v && typeof v === 'object' &&
      'id' in v && typeof v.id === 'string' &&
      'username' in v && typeof v.username === 'string' &&
      'dateKey' in v && typeof v.dateKey === 'string' &&
      'timeMs' in v && typeof v.timeMs === 'number' &&
      'ghostData' in v && typeof v.ghostData === 'string' &&
      'createdAt' in v && typeof v.createdAt === 'number'
    ) {
      return { id: v.id, username: v.username, dateKey: v.dateKey, timeMs: v.timeMs, ghostData: v.ghostData, createdAt: v.createdAt };
    }
  } catch {
    // fall through
  }
  return null;
}

export class RunStore {
  constructor(
    private readonly redis: RedisLike,
    private readonly now: () => number = Date.now,
  ) {}

  async getRun(id: string): Promise<RunRecord | null> {
    return parseRun(await this.redis.get(`${P}run:${id}`));
  }

  async getLeaderboard(date: string, username: string | null, limit = 10): Promise<LeaderboardResponse> {
    const lbKey = `${P}lb:${date}`;
    const [top, total] = await Promise.all([
      this.redis.zRange(lbKey, 0, Math.max(0, limit - 1), { by: 'rank' }),
      this.redis.zCard(lbKey),
    ]);
    const ids = top.length ? await this.redis.hMGet(`${P}best:${date}`, top.map((t) => t.member)) : [];
    const entries: LeaderboardEntry[] = top.map((t, i) => ({
      rank: i + 1,
      username: t.member,
      timeMs: t.score,
      runId: ids[i] ?? null,
    }));
    let me: PersonalStanding | null = null;
    if (username) {
      const [rank0, score] = await Promise.all([
        this.redis.zRank(lbKey, username),
        this.redis.zScore(lbKey, username),
      ]);
      if (rank0 !== undefined && score !== undefined) {
        let nextUsername: string | null = null;
        let gapToNextMs: number | null = null;
        if (rank0 > 0) {
          const above = await this.redis.zRange(lbKey, rank0 - 1, rank0 - 1, { by: 'rank' });
          const a = above[0];
          if (a) {
            nextUsername = a.member;
            gapToNextMs = score - a.score;
          }
        }
        me = {
          rank: rank0 + 1,
          username,
          timeMs: score,
          runId: (await this.redis.hGet(`${P}best:${date}`, username)) ?? null,
          gapToNextMs,
          nextUsername,
        };
      }
    }
    return { date, total, entries, me };
  }

  async getChampion(date: string): Promise<RunRecord | null> {
    const top = await this.redis.zRange(`${P}lb:${date}`, 0, 0, { by: 'rank' });
    const first = top[0];
    if (!first) return null;
    const id = await this.redis.hGet(`${P}best:${date}`, first.member);
    return id ? this.getRun(id) : null;
  }

  /** Store a validated run. Only personal bests enter the leaderboard. */
  async submit(username: string, dateKey: string, timeMs: number, ghostData: string, share: boolean): Promise<SubmitOutcome | null> {
    const lbKey = `${P}lb:${dateKey}`;
    const bestKey = `${P}best:${dateKey}`;
    const [previous, recordList] = await Promise.all([
      this.redis.zScore(lbKey, username),
      this.redis.zRange(lbKey, 0, 0, { by: 'rank' }),
    ]);
    const previousBestMs = previous ?? null;
    const isPersonalBest = previousBestMs === null || timeMs < previousBestMs;
    if (!isPersonalBest && !share) {
      return null;
    }
    const recordMs = recordList[0]?.score;
    const isRecord = isPersonalBest && (recordMs === undefined || timeMs < recordMs);
    const run: RunRecord = { id: newRunId(), username, dateKey, timeMs, ghostData, createdAt: this.now() };
    const allTime = isPermanent(dateKey);
    const runKey = `${P}run:${run.id}`;
    await this.redis.set(runKey, JSON.stringify(run));
    if (!isPersonalBest) await this.redis.expire(runKey, SHARED_TTL_S);
    else if (!allTime) await this.redis.expire(runKey, BEST_TTL_S);
    if (isPersonalBest) {
      const oldId = await this.redis.hGet(bestKey, username);
      await this.redis.zAdd(lbKey, { member: username, score: timeMs });
      await this.redis.hSet(bestKey, { [username]: run.id });
      if (!allTime) await Promise.all([this.redis.expire(lbKey, BEST_TTL_S), this.redis.expire(bestKey, BEST_TTL_S)]);
      // The superseded best may still be referenced by a challenge link.
      if (oldId && oldId !== run.id) await this.redis.expire(`${P}run:${oldId}`, SHARED_TTL_S);
    }
    return { run: summarize(run), isPersonalBest, isRecord, previousBestMs };
  }

  /** True if the user may submit now (one submission per 1.2s). */
  async allowSubmission(username: string): Promise<boolean> {
    const key = `${P}rl:${username}`;
    const existing = await this.redis.get(key);
    if (existing) return false;
    await this.redis.set(key, '1', { expiration: new Date(this.now() + 1200) });
    return true;
  }

  async getPostId(date: string): Promise<string | null> {
    return (await this.redis.get(`${P}post:${date}`)) ?? null;
  }

  /** Claim the right to create the post for a date (idempotent across cron retries). */
  async claimPost(date: string): Promise<boolean> {
    const key = `${P}postlock:${date}`;
    const n = await this.redis.incrBy(key, 1);
    if (n === 1) await this.redis.expire(key, 600);
    return n === 1;
  }

  async releasePostClaim(date: string): Promise<void> {
    await this.redis.del(`${P}postlock:${date}`);
  }

  async savePost(date: string, postId: string): Promise<void> {
    await this.redis.set(`${P}post:${date}`, postId);
    await this.redis.set(`${P}post:latest`, JSON.stringify({ date, postId }));
  }
}
