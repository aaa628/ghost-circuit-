/**
 * Devvit server entry (bundled to dist/server/index.cjs by @devvit/start).
 *
 * Reuses the exact same REST API as the local server, backed by Devvit Redis
 * and Reddit identity, plus the internal endpoints Devvit calls:
 *   /internal/menu/post-create        moderator menu: post (or open) today's circuit
 *   /internal/scheduler/daily-post    cron 00:00 UTC: post the new daily circuit
 *   /internal/triggers/on-app-install post today's circuit when installed
 */
import express from 'express';
import { context, createServer, getServerPort, reddit, redis } from '@devvit/web/server';
import type { TriggerResponse, UiResponse } from '@devvit/web/shared';
import { createApiRouter } from '../../server/app';
import { RunStore } from '../../server/RunStore';
import { isDateKey } from '../game/util/date';
import { ensureDailyPost } from './posts';

const store = new RunStore(redis);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '96kb' }));

app.use(
  '/api',
  createApiRouter({
    platform: 'devvit',
    store,
    now: Date.now,
    getUsername: async () => context.username ?? (await reddit.getCurrentUsername()) ?? null,
    getPostDateKey: async () => {
      const value = context.postData?.dateKey;
      return isDateKey(value) ? value : null;
    },
    postComment: async (_req, text) => {
      const postId = context.postId;
      if (!postId) throw new Error('no post in context');
      await reddit.submitComment({ id: postId, text, runAs: 'USER' });
    },
  }),
);

const internal = express.Router();

internal.post('/menu/post-create', async (_req, res) => {
  try {
    const { postId } = await ensureDailyPost(store);
    const body: UiResponse = {
      navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${postId.replace(/^t3_/, '')}`,
    };
    res.json(body);
  } catch (err) {
    console.error('[menu] post-create failed', err);
    const body: UiResponse = { showToast: 'Could not create the Ghost Circuit post' };
    res.status(400).json(body);
  }
});

internal.post('/scheduler/daily-post', async (_req, res) => {
  try {
    const result = await ensureDailyPost(store);
    console.log(`[scheduler] daily post ${result.created ? 'created' : 'exists'}: ${result.postId}`);
    res.json({ status: 'ok', postId: result.postId });
  } catch (err) {
    console.error('[scheduler] daily-post failed', err);
    res.status(500).json({ status: 'error' });
  }
});

internal.post('/triggers/on-app-install', async (_req, res) => {
  try {
    await ensureDailyPost(store);
    const body: TriggerResponse = {};
    res.json(body);
  } catch (err) {
    console.error('[trigger] on-app-install failed', err);
    res.status(400).json({});
  }
});

app.use('/internal', internal);

createServer(app).listen(getServerPort());
