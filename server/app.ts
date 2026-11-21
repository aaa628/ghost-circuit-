/**
 * Ghost Circuit REST API (Express router), shared by the standalone local
 * server and the Devvit server. Platform differences (who the player is,
 * which post we're in, posting comments) are injected via `ApiDeps`.
 *
 *   GET  /api/init
 *   GET  /api/leaderboard/:date
 *   GET  /api/champion/:date
 *   GET  /api/run/:runId
 *   POST /api/runs           (server-side anti-cheat validation)
 *   POST /api/comment        (Devvit only: post a challenge comment as the user)
 */
import express, { type Request, type Response, type Router } from 'express';
import { SUBMIT_GRACE_MS } from '../src/game/config';
import { generateTrack } from '../src/game/track/TrackGenerator';
import { isDateKey, shiftDateKey, utcDateKey } from '../src/game/util/date';
import {
  formatTime,
  isRunId,
  toChallengeCode,
  type ApiError,
  type ChampionResponse,
  type CommentResponse,
  type InitResponse,
  type Platform,
  type RunRecord,
  type SubmitRunResponse,
} from '../src/shared/api';
import { validateRun } from '../src/shared/runValidation';
import type { RunStore } from './RunStore';

export type ApiDeps = {
  platform: Platform;
  store: RunStore;
  now: () => number;
  /** Authoritative identity of the requester (never trust the body). */
  getUsername: (req: Request) => Promise<string | null>;
  /** Date key bound to the current post (Devvit postData), if any. */
  getPostDateKey?: (req: Request) => Promise<string | null>;
  /** Post a comment on the current post as the user (Devvit). */
  postComment?: (req: Request, text: string) => Promise<void>;
};

const send = <T>(res: Response, status: number, body: T): void => {
  res.status(status).json(body);
};

/** Dates a submission may target right now (today, plus yesterday during the grace window). */
export function acceptedSubmissionDates(now: number): string[] {
  const today = utcDateKey(now);
  const sinceMidnight = now % 86_400_000;
  return sinceMidnight < SUBMIT_GRACE_MS ? [today, shiftDateKey(today, -1)] : [today];
}

export function createApiRouter(deps: ApiDeps): Router {
  const router = express.Router();
  const { store } = deps;

  const wrap =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response): void => {
      fn(req, res).catch((err: unknown) => {
        console.error('[api] error', req.method, req.path, err);
        if (!res.headersSent) send<ApiError>(res, 500, { error: 'internal error' });
      });
    };

  router.get('/health', (_req, res) => {
    res.json({ ok: true, platform: deps.platform, time: deps.now() });
  });

  router.get(
    '/init',
    wrap(async (req, res) => {
      const today = utcDateKey(deps.now());
      const [username, postDateKey, todayPostId] = await Promise.all([
        deps.getUsername(req),
        deps.getPostDateKey ? deps.getPostDateKey(req) : Promise.resolve(null),
        store.getPostId(today),
      ]);
      send<InitResponse>(res, 200, {
        platform: deps.platform,
        username,
        today,
        postDateKey,
        todayPostId,
        serverTime: deps.now(),
      });
    }),
  );

  router.get(
    '/leaderboard/:date',
    wrap(async (req, res) => {
      const date = String(req.params.date);
      if (!isDateKey(date)) return send<ApiError>(res, 400, { error: 'invalid date' });
      const limitRaw = Number(req.query.limit ?? 10);
      const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, Math.floor(limitRaw))) : 10;
      const username = await deps.getUsername(req);
      send(res, 200, await store.getLeaderboard(date, username, limit));
    }),
  );

  router.get(
    '/champion/:date',
    wrap(async (req, res) => {
      const date = String(req.params.date);
      if (!isDateKey(date)) return send<ApiError>(res, 400, { error: 'invalid date' });
      send<ChampionResponse>(res, 200, { date, champion: await store.getChampion(date) });
    }),
  );

  router.get(
    '/run/:runId',
    wrap(async (req, res) => {
      const id = String(req.params.runId);
      if (!isRunId(id)) return send<ApiError>(res, 400, { error: 'invalid run id' });
      const run = await store.getRun(id);
      if (!run) return send<ApiError>(res, 404, { error: 'run not found' });
      send<RunRecord>(res, 200, run);
    }),
  );

  router.post(
    '/runs',
    wrap(async (req, res) => {
      const username = await deps.getUsername(req);
      if (!username) return send<SubmitRunResponse>(res, 401, { accepted: false, reason: 'log in to post times' });
      const body: unknown = req.body;
      if (!body || typeof body !== 'object') return send<SubmitRunResponse>(res, 400, { accepted: false, reason: 'bad request' });
      const { dateKey, timeMs, ghostData, share } = body as Record<string, unknown>;
      if (!isDateKey(dateKey)) return send<SubmitRunResponse>(res, 400, { accepted: false, reason: 'invalid date' });
      if (!acceptedSubmissionDates(deps.now()).includes(dateKey)) {
        return send<SubmitRunResponse>(res, 409, { accepted: false, reason: 'this circuit is closed — race today’s track' });
      }
      if (!(await store.allowSubmission(username))) {
        return send<SubmitRunResponse>(res, 429, { accepted: false, reason: 'slow down' });
      }
      const track = generateTrack(dateKey);
      const verdict = validateRun(track, timeMs, ghostData);
      if (!verdict.ok) {
        console.warn(`[api] rejected run from ${username}: ${verdict.reason}`);
        return send<SubmitRunResponse>(res, 422, { accepted: false, reason: verdict.reason });
      }
      const outcome = await store.submit(username, dateKey, timeMs as number, ghostData as string, share === true);
      const leaderboard = await store.getLeaderboard(dateKey, username, 10);
      if (!outcome) {
        return send<SubmitRunResponse>(res, 200, { accepted: false, reason: 'not a personal best' });
      }
      send<SubmitRunResponse>(res, 200, { accepted: true, ...outcome, leaderboard });
    }),
  );

  router.post(
    '/comment',
    wrap(async (req, res) => {
      if (!deps.postComment) return send<CommentResponse>(res, 501, { ok: false, reason: 'comments unavailable here' });
      const username = await deps.getUsername(req);
      if (!username) return send<CommentResponse>(res, 401, { ok: false, reason: 'log in to comment' });
      const body = req.body as Record<string, unknown> | undefined;
      const runId = body?.runId;
      if (!isRunId(runId)) return send<CommentResponse>(res, 400, { ok: false, reason: 'invalid run id' });
      const run = await store.getRun(runId);
      if (!run || run.username !== username) return send<CommentResponse>(res, 403, { ok: false, reason: 'not your run' });
      const track = generateTrack(run.dateKey);
      const text =
        `🏁 I set **${formatTime(run.timeMs)}s** on Ghost Circuit #${track.circuitNo} — *${track.name}*. ` +
        `Think you can beat my ghost?\n\nChallenge code: \`${toChallengeCode(run.id)}\` ` +
        `(open the game → Leaderboard → Enter code)`;
      await deps.postComment(req, text);
      send<CommentResponse>(res, 200, { ok: true });
    }),
  );

  return router;
}
