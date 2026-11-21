import { reddit } from '@devvit/web/server';
import type { RunStore } from '../../server/RunStore';
import { generateTrack } from '../game/track/TrackGenerator';
import { formatDateLabel, utcDateKey } from '../game/util/date';

export type DailyPostResult = { postId: string; created: boolean };

/** Create today's daily circuit post exactly once (safe under cron retries). */
export async function ensureDailyPost(store: RunStore, now: number = Date.now()): Promise<DailyPostResult> {
  const dateKey = utcDateKey(now);
  const existing = await store.getPostId(dateKey);
  if (existing) return { postId: existing, created: false };
  if (!(await store.claimPost(dateKey))) {
    // Another invocation is creating it right now; give it a moment.
    await new Promise((r) => setTimeout(r, 1500));
    const again = await store.getPostId(dateKey);
    if (again) return { postId: again, created: false };
  }
  const track = generateTrack(dateKey);
  try {
    const post = await reddit.submitCustomPost({
      title: `🏁 Ghost Circuit #${track.circuitNo} — ${track.name} (${formatDateLabel(dateKey)})`,
      entry: 'default',
      postData: { dateKey },
      textFallback: {
        text:
          `Today's Ghost Circuit is **${track.name}**. Open this post in the Reddit app or on new Reddit ` +
          `to race the daily 60-second time trial against real players' ghosts.`,
      },
    });
    await store.savePost(dateKey, post.id);
    return { postId: post.id, created: true };
  } catch (err) {
    await store.releasePostClaim(dateKey);
    throw err;
  }
}
