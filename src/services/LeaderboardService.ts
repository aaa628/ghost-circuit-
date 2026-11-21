/**
 * LeaderboardService — everything the client knows about runs and ghosts.
 *
 *  • REST client for /api (leaderboard, champion, run, submit, comment)
 *  • localStorage fallback that works with zero setup: if the API can't be
 *    reached the game switches to an offline leaderboard pre-seeded with
 *    autopilot ghosts that are generated on the real physics for that day's
 *    circuit (so they always pass validation)
 *  • anti-cheat pre-flight + validation of every downloaded ghost
 *  • challenge link encoding/decoding (URL params locally, share data on Reddit)
 *  • Yesterday's Champion loader and personal-best cache
 */
import { SKILLS, runAutopilot, type DriverSkill } from '../game/ai/Autopilot';
import { decodeGhost, type GhostFrames } from '../game/ghost/GhostCodec';
import { PERMANENT_CIRCUITS, isCircuitKey, isPermanent } from '../game/track/Circuits';
import { generateTrack } from '../game/track/TrackGenerator';
import type { Track } from '../game/track/TrackTypes';
import { shiftDateKey, utcDateKey } from '../game/util/date';
import {
  formatTime,
  isRunId,
  isUsername,
  type CommentResponse,
  type InitResponse,
  type LeaderboardEntry,
  type LeaderboardResponse,
  type Platform,
  type RunRecord,
  type SubmitRunRequest,
  type SubmitRunResponse,
} from '../shared/api';
import { validateFrames, validateRun } from '../shared/runValidation';
import {
  IS_DEVVIT,
  challengeUrl,
  currentUsername,
  postDateKey,
  readShareChallenge,
  readUrlChallenge,
  takePendingChallenge,
  type ChallengeRef,
} from './platform';
import { pruneByDate, readJson, readString, writeJson, writeString } from './storage';

const API_TIMEOUT_MS = 6000;
const NICK_KEY = 'gc:v1:nickname';
const PB_PREFIX = 'gc:v2:pb:';
const OFFLINE_PREFIX = 'gc:v2:offline:';

export type ServiceMode = 'online' | 'offline';

export type CachedPb = { timeMs: number; ghostData: string; runId: string | null };

const isCachedPb = (v: unknown): v is CachedPb =>
  !!v && typeof v === 'object' &&
  'timeMs' in v && typeof v.timeMs === 'number' &&
  'ghostData' in v && typeof v.ghostData === 'string' &&
  'runId' in v && (v.runId === null || typeof v.runId === 'string');

const isRunRecord = (v: unknown): v is RunRecord =>
  !!v && typeof v === 'object' &&
  'id' in v && typeof v.id === 'string' &&
  'username' in v && typeof v.username === 'string' &&
  'dateKey' in v && typeof v.dateKey === 'string' &&
  'timeMs' in v && typeof v.timeMs === 'number' &&
  'ghostData' in v && typeof v.ghostData === 'string' &&
  'createdAt' in v && typeof v.createdAt === 'number';

type OfflineRun = RunRecord & { bot?: boolean };
const isOfflineList = (v: unknown): v is OfflineRun[] => Array.isArray(v) && v.every(isRunRecord);

/** Pre-seeded autopilot rivals for offline play. */
const PERSONAS: ReadonlyArray<{ name: string; skill: DriverSkill }> = [
  { name: 'NeonNomad', skill: SKILLS.pace },
  { name: 'ApexAxolotl', skill: SKILLS.pro },
  { name: 'DriftDruid', skill: SKILLS.good },
  { name: 'GhostPepper', skill: SKILLS.casual },
  { name: 'TurboTurtle', skill: SKILLS.rookie },
];

const ADJ = ['Turbo', 'Neon', 'Pixel', 'Drift', 'Laser', 'Nitro', 'Comet', 'Volt'];
const NOUN = ['Fox', 'Otter', 'Comet', 'Racer', 'Moth', 'Lynx', 'Gecko', 'Raven'];

function randomNickname(): string {
  const r = (n: number): number => Math.floor(Math.random() * n);
  return `${ADJ[r(ADJ.length)]}${NOUN[r(NOUN.length)]}${10 + r(90)}`;
}

/** localStorage leaderboard used when the API is unreachable. */
class OfflineStore {
  private key(date: string): string {
    return `${OFFLINE_PREFIX}${date}`;
  }

  private load(date: string): OfflineRun[] {
    const list = readJson(this.key(date), isOfflineList);
    if (list) return list;
    const seeded = this.seed(date);
    writeJson(this.key(date), seeded);
    return seeded;
  }

  private save(date: string, list: OfflineRun[]): void {
    writeJson(this.key(date), list.slice(0, 60));
  }

  /** Generate genuine ghosts by letting the autopilot drive the real physics. */
  private seed(date: string): OfflineRun[] {
    const track = generateTrack(date);
    const out: OfflineRun[] = [];
    PERSONAS.forEach((p, i) => {
      const lap = runAutopilot(track, p.skill);
      if (!lap.finished) return;
      out.push({
        id: `b${date.replace(/-/g, '')}${i}`,
        username: p.name,
        dateKey: date,
        timeMs: lap.timeMs,
        ghostData: lap.ghostData,
        createdAt: Date.parse(`${date}T00:00:00Z`),
        bot: true,
      });
    });
    return out.sort((a, b) => a.timeMs - b.timeMs);
  }

  leaderboard(date: string, username: string | null, limit: number): LeaderboardResponse {
    const best = this.bestPerUser(date);
    const entries: LeaderboardEntry[] = best.slice(0, limit).map((r, i) => ({
      rank: i + 1,
      username: r.username,
      timeMs: r.timeMs,
      runId: r.id,
      ...(r.bot ? { bot: true } : {}),
    }));
    let me: LeaderboardResponse['me'] = null;
    const idx = username ? best.findIndex((r) => r.username === username) : -1;
    if (idx >= 0) {
      const mine = best[idx] as OfflineRun;
      const above = idx > 0 ? best[idx - 1] : undefined;
      me = {
        rank: idx + 1,
        username: mine.username,
        timeMs: mine.timeMs,
        runId: mine.id,
        gapToNextMs: above ? mine.timeMs - above.timeMs : null,
        nextUsername: above ? above.username : null,
      };
    }
    return { date, total: best.length, entries, me };
  }

  private bestPerUser(date: string): OfflineRun[] {
    const seen = new Map<string, OfflineRun>();
    for (const r of this.load(date)) {
      const cur = seen.get(r.username);
      if (!cur || r.timeMs < cur.timeMs) seen.set(r.username, r);
    }
    return [...seen.values()].sort((a, b) => a.timeMs - b.timeMs);
  }

  run(id: string, dates: readonly string[]): RunRecord | null {
    for (const d of dates) {
      const hit = this.load(d).find((r) => r.id === id);
      if (hit) return hit;
    }
    return null;
  }

  champion(date: string): RunRecord | null {
    return this.bestPerUser(date)[0] ?? null;
  }

  submit(username: string, req: SubmitRunRequest): SubmitRunResponse {
    const list = this.load(req.dateKey);
    const best = this.bestPerUser(req.dateKey);
    const previous = best.find((r) => r.username === username) ?? null;
    const isPersonalBest = !previous || req.timeMs < previous.timeMs;
    if (!isPersonalBest && !req.share) return { accepted: false, reason: 'not a personal best' };
    const record = best[0];
    const run: OfflineRun = {
      id: `o${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}`.slice(0, 12),
      username,
      dateKey: req.dateKey,
      timeMs: req.timeMs,
      ghostData: req.ghostData,
      createdAt: Date.now(),
    };
    list.push(run);
    list.sort((a, b) => a.timeMs - b.timeMs);
    this.save(req.dateKey, list);
    return {
      accepted: true,
      run: { id: run.id, username: run.username, dateKey: run.dateKey, timeMs: run.timeMs, createdAt: run.createdAt },
      isPersonalBest,
      isRecord: isPersonalBest && (!record || req.timeMs < record.timeMs),
      previousBestMs: previous ? previous.timeMs : null,
      leaderboard: this.leaderboard(req.dateKey, username, 10),
    };
  }
}

class HttpError extends Error {
  constructor(readonly status: number, readonly body: unknown) {
    super(`HTTP ${status}`);
  }
}

export class LeaderboardService {
  mode: ServiceMode = 'online';
  platform: Platform = IS_DEVVIT ? 'devvit' : 'local';
  username: string | null = null;
  postDateKey: string | null = null;
  todayPostId: string | null = null;
  /** Fired when the service drops to offline mode. */
  onModeChange: ((mode: ServiceMode) => void) | null = null;
  private clockOffset = 0;
  private readonly offline = new OfflineStore();
  private readonly runCache = new Map<string, RunRecord>();
  private readonly paceCache = new Map<string, RunRecord>();

  /** Server-corrected "now" (keeps the daily rollover honest on skewed clocks). */
  now(): number {
    return Date.now() + this.clockOffset;
  }

  today(): string {
    return utcDateKey(this.now());
  }

  get nickname(): string {
    const saved = readString(NICK_KEY);
    if (saved && isUsername(saved)) return saved;
    const fresh = randomNickname();
    writeString(NICK_KEY, fresh);
    return fresh;
  }

  /** Rename the local player (standalone mode only). Returns false if invalid. */
  setNickname(name: string): boolean {
    if (this.platform !== 'local' || !isUsername(name)) return false;
    writeString(NICK_KEY, name);
    this.username = name;
    return true;
  }

  async init(): Promise<void> {
    this.postDateKey = postDateKey();
    try {
      const info = await this.request<InitResponse>('/api/init');
      this.platform = info.platform;
      this.clockOffset = Math.abs(info.serverTime - Date.now()) > 2000 ? info.serverTime - Date.now() : 0;
      this.username = info.platform === 'local' ? this.nickname : info.username;
      this.postDateKey = info.postDateKey ?? this.postDateKey;
      this.todayPostId = info.todayPostId;
    } catch (err) {
      console.warn('[leaderboard] API unavailable, using offline leaderboard', err);
      this.goOffline();
    }
    pruneByDate(OFFLINE_PREFIX, this.storedDates());
  }

  private goOffline(): void {
    if (this.mode === 'offline') return;
    this.mode = 'offline';
    this.username = this.platform === 'local' ? this.nickname : (this.username ?? currentUsername() ?? 'you');
    this.onModeChange?.('offline');
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
    const headers = new Headers(init?.headers);
    if (init?.body) headers.set('content-type', 'application/json');
    if (this.platform === 'local') headers.set('x-gc-player', this.username ?? this.nickname);
    try {
      const res = await fetch(path, { ...init, headers, signal: ctrl.signal });
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      if (!res.ok) throw new HttpError(res.status, body);
      if (body === null) throw new HttpError(res.status, null);
      return body as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Network-level failures (not HTTP 4xx) switch the session to offline mode. */
  private isNetworkFailure(err: unknown): boolean {
    if (err instanceof HttpError) return err.status >= 500 || (err.status === 404 && err.body === null);
    return true;
  }

  /** Circuits whose offline boards are kept: today, yesterday and the all-time ones. */
  private storedDates(): string[] {
    const t = this.today();
    return [t, shiftDateKey(t, -1), ...PERMANENT_CIRCUITS.map((c) => c.id)];
  }

  async getLeaderboard(date: string, limit = 10): Promise<LeaderboardResponse> {
    if (this.mode === 'online') {
      try {
        return await this.request<LeaderboardResponse>(`/api/leaderboard/${date}?limit=${limit}`);
      } catch (err) {
        if (!this.isNetworkFailure(err)) throw err;
        this.goOffline();
      }
    }
    return this.offline.leaderboard(date, this.username, limit);
  }

  async getRun(id: string): Promise<RunRecord | null> {
    if (!isRunId(id)) return null;
    const cached = this.runCache.get(id);
    if (cached) return cached;
    let run: RunRecord | null = null;
    if (this.mode === 'online') {
      try {
        const body = await this.request<unknown>(`/api/run/${id}`);
        run = isRunRecord(body) ? body : null;
      } catch (err) {
        if (err instanceof HttpError && err.status === 404 && err.body !== null) return null;
        if (!this.isNetworkFailure(err)) return null;
        this.goOffline();
      }
    }
    if (!run && this.mode === 'offline') run = this.offline.run(id, this.storedDates());
    if (run) this.runCache.set(id, run);
    return run;
  }

  async getChampion(date: string): Promise<RunRecord | null> {
    if (this.mode === 'online') {
      try {
        const body = await this.request<{ champion: unknown }>(`/api/champion/${date}`);
        return isRunRecord(body.champion) ? body.champion : null;
      } catch (err) {
        if (!this.isNetworkFailure(err)) return null;
        this.goOffline();
      }
    }
    return this.offline.champion(date);
  }

  /** Yesterday's #1 run (and ghost), for "Challenge Yesterday's Champ". */
  async loadYesterdayChampion(): Promise<RunRecord | null> {
    const yesterday = shiftDateKey(this.today(), -1);
    return this.getChampion(yesterday);
  }

  /** Client-side pre-flight with the exact validator the server runs. */
  preflight(track: Track, timeMs: number, ghostData: string): string | null {
    const v = validateRun(track, timeMs, ghostData);
    return v.ok ? null : v.reason;
  }

  async submitRun(req: SubmitRunRequest): Promise<SubmitRunResponse> {
    const reason = this.preflight(generateTrack(req.dateKey), req.timeMs, req.ghostData);
    if (reason) return { accepted: false, reason };
    let result: SubmitRunResponse;
    if (this.mode === 'online') {
      try {
        result = await this.request<SubmitRunResponse>('/api/runs', { method: 'POST', body: JSON.stringify(req) });
      } catch (err) {
        if (err instanceof HttpError) {
          const body = err.body as Partial<SubmitRunResponse> | null;
          if (!this.isNetworkFailure(err)) {
            return { accepted: false, reason: (body && 'reason' in body && body.reason) || `error ${err.status}` };
          }
        }
        this.goOffline();
        result = this.offline.submit(this.username ?? this.nickname, req);
      }
    } else {
      result = this.offline.submit(this.username ?? this.nickname, req);
    }
    if (result.accepted && result.isPersonalBest) {
      this.savePersonalBest(req.dateKey, { timeMs: req.timeMs, ghostData: req.ghostData, runId: result.run.id });
    }
    if (result.accepted) {
      this.runCache.set(result.run.id, { ...result.run, ghostData: req.ghostData });
    }
    return result;
  }

  async postChallengeComment(runId: string): Promise<CommentResponse> {
    if (this.platform !== 'devvit' || this.mode !== 'online') return { ok: false, reason: 'comments are only available on Reddit' };
    try {
      return await this.request<CommentResponse>('/api/comment', { method: 'POST', body: JSON.stringify({ runId }) });
    } catch (err) {
      const body = err instanceof HttpError ? (err.body as Partial<CommentResponse> | null) : null;
      return { ok: false, reason: body?.reason ?? 'could not post the comment' };
    }
  }

  private pbKey(date: string): string {
    return `${PB_PREFIX}${this.username ?? 'anon'}:${date}`;
  }

  getPersonalBest(date: string): CachedPb | null {
    return readJson(this.pbKey(date), isCachedPb);
  }

  savePersonalBest(date: string, pb: CachedPb): void {
    const current = this.getPersonalBest(date);
    if (!current || pb.timeMs < current.timeMs || current.runId === null) writeJson(this.pbKey(date), pb);
  }

  /** Decode + validate a ghost against its circuit; null if it fails anti-cheat. */
  validGhost(track: Track, timeMs: number, ghostData: string): GhostFrames | null {
    const frames = decodeGhost(ghostData);
    if (!frames) return null;
    const v = validateFrames(track, timeMs, frames);
    return v.ok ? frames : null;
  }

  /** Deterministic pace-car ghost for circuits nobody has raced yet. */
  paceRun(date: string): RunRecord | null {
    const cached = this.paceCache.get(date);
    if (cached) return cached;
    const lap = runAutopilot(generateTrack(date), SKILLS.pace);
    if (!lap.finished) return null;
    const run: RunRecord = {
      id: `pace${date.replace(/-/g, '')}`,
      username: 'PACE BOT',
      dateKey: date,
      timeMs: lap.timeMs,
      ghostData: lap.ghostData,
      createdAt: 0,
    };
    this.paceCache.set(date, run);
    return run;
  }

  /** Challenge handed to this page: URL params, Reddit share data, or splash hand-off. */
  readIncomingChallenge(): ChallengeRef | null {
    return readUrlChallenge() ?? readShareChallenge() ?? takePendingChallenge();
  }

  encodeChallengeUrl(date: string, runId: string): string {
    return challengeUrl({ date, runId });
  }

  decodeChallengeUrl(url: string): ChallengeRef | null {
    try {
      const u = new URL(url);
      const date = u.searchParams.get('date') ?? u.searchParams.get('circuit');
      const runId = u.searchParams.get('challenge');
      return isCircuitKey(date) && isRunId(runId) ? { date, runId } : null;
    } catch {
      return null;
    }
  }

  /** True if a finished run on this circuit can be ranked right now. */
  isRanked(circuit: string): boolean {
    return isPermanent(circuit) || circuit === this.today();
  }

  shareSnippet(timeMs: number, track: Track, link: string | null): string {
    const where = isPermanent(track.dateKey)
      ? `Ghost Circuit's all-time ${track.name}`
      : `today's Ghost Circuit (#${track.circuitNo} ${track.name})`;
    const base = `I set ${formatTime(timeMs)}s on ${where} — beat my ghost!`;
    return link ? `${base} ${link}` : base;
  }
}
