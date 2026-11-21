import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { createApiRouter } from '../server/app';
import { MemoryRedis } from '../server/MemoryRedis';
import { RunStore } from '../server/RunStore';
import { SKILLS, runAutopilot } from '../src/game/ai/Autopilot';
import { generateTrack } from '../src/game/track/TrackGenerator';
import { utcDateKey, shiftDateKey } from '../src/game/util/date';
import { isUsername, type LeaderboardResponse, type RunRecord, type SubmitRunResponse } from '../src/shared/api';

describe('RunStore', () => {
  it('keeps one best per player, ranks ascending, reports gaps', async () => {
    const store = new RunStore(new MemoryRedis());
    const d = '2026-11-21';
    assert.ok(await store.submit('alice', d, 25_000, 'g', false));
    assert.ok(await store.submit('bob', d, 24_000, 'g', false));
    assert.ok(await store.submit('carol', d, 26_500, 'g', false));
    assert.equal(await store.submit('alice', d, 25_500, 'g', false), null, 'slower run is not stored');
    const pb = await store.submit('alice', d, 23_900, 'g', false);
    assert.ok(pb?.isPersonalBest && pb.isRecord);
    const lb = await store.getLeaderboard(d, 'carol');
    assert.deepEqual(lb.entries.map((e) => e.username), ['alice', 'bob', 'carol']);
    assert.equal(lb.total, 3);
    assert.equal(lb.me?.rank, 3);
    assert.equal(lb.me?.gapToNextMs, 2_500);
    assert.equal(lb.me?.nextUsername, 'bob');
    const champ = await store.getChampion(d);
    assert.equal(champ?.username, 'alice');
    assert.equal(champ?.timeMs, 23_900);
    const shared = await store.submit('bob', d, 30_000, 'g2', true);
    assert.ok(shared && !shared.isPersonalBest);
    assert.equal((await store.getRun(shared.run.id))?.ghostData, 'g2');
    assert.equal((await store.getLeaderboard(d, 'bob')).me?.timeMs, 24_000);
  });
});

describe('REST API', () => {
  let base = '';
  let close: () => void = () => undefined;
  const today = utcDateKey();

  before(async () => {
    const store = new RunStore(new MemoryRedis());
    const app = express();
    app.use(express.json({ limit: '96kb' }));
    app.use(
      '/api',
      createApiRouter({
        platform: 'local',
        store,
        now: Date.now,
        getUsername: async (req) => {
          const h = req.header('x-gc-player');
          return isUsername(h) ? h : null;
        },
      }),
    );
    const server = app.listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    close = () => server.close();
  });
  after(() => close());

  const post = async (path: string, body: unknown, player = 'tester_1'): Promise<{ status: number; json: SubmitRunResponse }> => {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gc-player': player },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as SubmitRunResponse };
  };

  it('accepts a valid run, serves leaderboard, champion and ghost', async () => {
    const track = generateTrack(today);
    const lap = runAutopilot(track, SKILLS.good);
    assert.ok(lap.finished);
    const { status, json } = await post('/runs', { dateKey: today, timeMs: lap.timeMs, ghostData: lap.ghostData });
    assert.equal(status, 200);
    assert.ok(json.accepted);
    if (!json.accepted) return;
    assert.ok(json.isPersonalBest && json.isRecord);
    assert.equal(json.leaderboard.entries[0]?.username, 'tester_1');

    const lb = (await (await fetch(`${base}/leaderboard/${today}`, { headers: { 'x-gc-player': 'tester_1' } })).json()) as LeaderboardResponse;
    assert.equal(lb.me?.rank, 1);
    const run = (await (await fetch(`${base}/run/${json.run.id}`)).json()) as RunRecord;
    assert.equal(run.ghostData, lap.ghostData);
    const champ = (await (await fetch(`${base}/champion/${today}`)).json()) as { champion: RunRecord | null };
    assert.equal(champ.champion?.id, json.run.id);
  });

  it('ranks all-time circuits on any day and keeps their board', async () => {
    const track = generateTrack('perm-ridge');
    const lap = runAutopilot(track, SKILLS.good);
    assert.ok(lap.finished);
    const { status, json } = await post('/runs', { dateKey: 'perm-ridge', timeMs: lap.timeMs, ghostData: lap.ghostData }, 'alltimer_1');
    assert.equal(status, 200);
    assert.ok(json.accepted);
    const lb = (await (await fetch(`${base}/leaderboard/perm-ridge`)).json()) as LeaderboardResponse;
    assert.equal(lb.entries[0]?.username, 'alltimer_1');
    assert.equal((await fetch(`${base}/leaderboard/perm-unknown`)).status, 400);
  });

  it('rejects tampered, anonymous, closed-day and malformed submissions', async () => {
    const track = generateTrack(today);
    const lap = runAutopilot(track, SKILLS.casual);
    assert.ok(lap.finished);
    const faked = await post('/runs', { dateKey: today, timeMs: lap.timeMs - 4000, ghostData: lap.ghostData }, 'cheater_1');
    assert.equal(faked.status, 422);
    assert.equal(faked.json.accepted, false);

    const anon = await fetch(`${base}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dateKey: today, timeMs: lap.timeMs, ghostData: lap.ghostData }),
    });
    assert.equal(anon.status, 401);

    const old = await post('/runs', { dateKey: shiftDateKey(today, -3), timeMs: lap.timeMs, ghostData: lap.ghostData }, 'late_1');
    assert.equal(old.status, 409);

    const junk = await post('/runs', { dateKey: today, timeMs: 'fast', ghostData: 42 }, 'junk_1');
    assert.equal(junk.status, 422);

    assert.equal((await fetch(`${base}/leaderboard/not-a-date`)).status, 400);
    assert.equal((await fetch(`${base}/run/zzzzzzzz`)).status, 404);
  });
});
