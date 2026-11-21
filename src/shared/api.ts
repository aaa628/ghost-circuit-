/** Wire types shared by the client and both servers. */

export type Platform = 'devvit' | 'local';

export type RunRecord = {
  id: string;
  username: string;
  dateKey: string;
  timeMs: number;
  /** base64url ghost (see GhostCodec). */
  ghostData: string;
  createdAt: number;
};

export type RunSummary = Omit<RunRecord, 'ghostData'>;

export type LeaderboardEntry = {
  rank: number;
  username: string;
  timeMs: number;
  runId: string | null;
  /** Offline mode only: a pre-seeded autopilot ghost. */
  bot?: boolean;
};

export type PersonalStanding = LeaderboardEntry & {
  /** Milliseconds slower than the next rank above (null when #1). */
  gapToNextMs: number | null;
  nextUsername: string | null;
};

export type LeaderboardResponse = {
  date: string;
  total: number;
  entries: LeaderboardEntry[];
  me: PersonalStanding | null;
};

export type ChampionResponse = {
  date: string;
  champion: RunRecord | null;
};

export type SubmitRunRequest = {
  dateKey: string;
  timeMs: number;
  ghostData: string;
  /** Store the run for a challenge link even if it isn't a personal best. */
  share?: boolean;
};

export type SubmitRunAccepted = {
  accepted: true;
  run: RunSummary;
  isPersonalBest: boolean;
  isRecord: boolean;
  previousBestMs: number | null;
  leaderboard: LeaderboardResponse;
};

export type SubmitRunRejected = { accepted: false; reason: string };

export type SubmitRunResponse = SubmitRunAccepted | SubmitRunRejected;

export type InitResponse = {
  platform: Platform;
  username: string | null;
  today: string;
  /** Date key bound to the current Reddit post, if any. */
  postDateKey: string | null;
  /** Today's daily post id (Devvit) so archived posts can link to it. */
  todayPostId: string | null;
  serverTime: number;
};

export type CommentRequest = { runId: string };
export type CommentResponse = { ok: boolean; reason?: string };

export type ApiError = { error: string };

const RUN_ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const RUN_ID_RE = /^[a-z0-9]{6,16}$/;
const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;

/** Random 8-char run id from a crypto source. */
export function newRunId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += RUN_ID_ALPHABET[b % RUN_ID_ALPHABET.length];
  return out;
}

export function isRunId(value: unknown): value is string {
  return typeof value === 'string' && RUN_ID_RE.test(value);
}

export function isUsername(value: unknown): value is string {
  return typeof value === 'string' && USERNAME_RE.test(value);
}

/** "GC-K3J9X2QF" ↔ run id. */
export function toChallengeCode(runId: string): string {
  return `GC-${runId.toUpperCase()}`;
}

export function fromChallengeCode(code: string): string | null {
  const cleaned = code.trim().replace(/^GC-?/i, '').toLowerCase();
  return isRunId(cleaned) ? cleaned : null;
}

/** "24.812" */
export function formatTime(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const s = Math.floor(clamped / 1000);
  const rest = clamped % 1000;
  return `${s < 10 ? '0' : ''}${s}.${rest.toString().padStart(3, '0')}`;
}

/** "0.124" — an unsigned gap without zero-padding. */
export function formatGap(ms: number): string {
  const abs = Math.abs(Math.round(ms));
  return `${Math.floor(abs / 1000)}.${(abs % 1000).toString().padStart(3, '0')}`;
}

/** "-0.312" / "+0.145" */
export function formatDelta(ms: number): string {
  const sign = ms < 0 ? '-' : '+';
  const abs = Math.abs(Math.round(ms));
  return `${sign}${Math.floor(abs / 1000)}.${(abs % 1000).toString().padStart(3, '0')}`;
}
