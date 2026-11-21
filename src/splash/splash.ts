/**
 * Inline feed view (splash.html). Fast, no Phaser: shows today's circuit with
 * the #1 ghost looping its lap, today's standings, the next-circuit countdown,
 * an incoming challenge (from a shared link), and launches the expanded game.
 */
import '../styles/splash.css';
import { GHOST_STYLE } from '../game/config';
import { GhostTimeline } from '../game/ghost/GhostTimeline';
import { generateTrack } from '../game/track/TrackGenerator';
import { dateKeyToMs, formatCountdown, formatDateLabel, msUntilNextUtcDay } from '../game/util/date';
import { LeaderboardService } from '../services/LeaderboardService';
import { IS_DEVVIT, launchGame, openPost, stashPendingChallenge, type ChallengeRef } from '../services/platform';
import { formatTime, type RunRecord } from '../shared/api';
import { TrackPreview, type PreviewGhost } from './TrackPreview';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

const service = new LeaderboardService();
const preview = new TrackPreview($<HTMLCanvasElement>('preview'));
let challenge: ChallengeRef | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;

function displayName(run: RunRecord): string {
  return run.username === 'PACE BOT' || service.platform === 'local' ? run.username : `u/${run.username}`;
}

async function render(): Promise<void> {
  const today = service.today();
  const postDate = service.postDateKey;
  const archived = !!postDate && dateKeyToMs(postDate) < dateKeyToMs(today);
  const date = archived && postDate ? postDate : today;
  const track = generateTrack(date);

  $('pill').textContent = `${archived ? 'ARCHIVE' : 'TODAY'} · #${track.circuitNo} · ${formatDateLabel(date)}`;
  $('track-name').textContent = track.name;
  const hazards = track.obstacles.filter((o) => o.type === 'sweeper' || o.type === 'pulsar' || o.type === 'gate').length;
  $('track-facts').textContent =
    `${track.archetypeLabel} · ${track.checkpoints.length} checkpoints · ${track.boostPads.length} boost pads · ${hazards} hazards` +
    (track.zones.some((z) => z.kind === 'split') ? ' · split lanes' : '');
  preview.setTrack(track);

  const raceBtn = $<HTMLButtonElement>('race');
  const secondary = $<HTMLButtonElement>('secondary');
  if (archived) {
    raceBtn.textContent = 'RACE TODAY’S CIRCUIT';
    secondary.hidden = false;
    secondary.textContent = 'Practice this archived circuit';
  } else {
    raceBtn.textContent = 'RACE TODAY’S CIRCUIT';
    secondary.hidden = true;
  }

  const lb = await service.getLeaderboard(date, 3).catch(() => null);
  $('racers').textContent = String(lb?.total ?? 0);
  const top = lb?.entries[0];
  const ghosts: PreviewGhost[] = [];
  if (top?.runId) {
    $('rec').textContent = `${formatTime(top.timeMs)} · ${top.bot || service.platform === 'local' ? top.username : `u/${top.username}`}`;
    const run = await service.getRun(top.runId);
    const frames = run ? service.validGhost(track, run.timeMs, run.ghostData) : null;
    if (frames) ghosts.push({ timeline: new GhostTimeline(frames, track), color: GHOST_STYLE.record.css });
  } else {
    $('rec').textContent = 'Be the first!';
    const pace = service.paceRun(date);
    const frames = pace ? service.validGhost(track, pace.timeMs, pace.ghostData) : null;
    if (frames) ghosts.push({ timeline: new GhostTimeline(frames, track), color: GHOST_STYLE.record.css });
  }
  const pb = lb?.me?.timeMs ?? service.getPersonalBest(date)?.timeMs ?? null;
  $('pb').textContent = pb === null ? '—' : `${formatTime(pb)}${lb?.me ? ` (#${lb.me.rank})` : ''}`;
  const pbLocal = service.getPersonalBest(date);
  if (pbLocal) {
    const frames = service.validGhost(track, pbLocal.timeMs, pbLocal.ghostData);
    if (frames) ghosts.push({ timeline: new GhostTimeline(frames, track), color: GHOST_STYLE.pb.css });
  }
  preview.setGhosts(ghosts);

  if (challenge) {
    const run = await service.getRun(challenge.runId);
    const card = $('challenge');
    if (run) {
      card.hidden = false;
      $('challenge-text').textContent = `⚔ ${displayName(run)} challenged you · ${formatTime(run.timeMs)}`;
    } else {
      card.hidden = true;
      challenge = null;
    }
  }
}

function startCountdown(): void {
  const el = $('countdown');
  const tick = (): void => {
    el.textContent = formatCountdown(msUntilNextUtcDay(service.now()));
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

function wire(): void {
  $<HTMLButtonElement>('race').addEventListener('click', (e) => {
    const today = service.today();
    const archived = !!service.postDateKey && dateKeyToMs(service.postDateKey) < dateKeyToMs(today);
    if (archived && IS_DEVVIT && service.todayPostId) {
      openPost(service.todayPostId);
      return;
    }
    launchGame(e);
  });
  $<HTMLButtonElement>('secondary').addEventListener('click', (e) => launchGame(e));
  $<HTMLButtonElement>('accept').addEventListener('click', (e) => {
    if (!challenge) return;
    stashPendingChallenge(challenge);
    launchGame(e, `?date=${challenge.date}&challenge=${challenge.runId}`);
  });
  // Coming back from the expanded game: refresh standings.
  window.addEventListener('focus', () => void render().catch(() => undefined));
}

async function main(): Promise<void> {
  wire();
  await service.init();
  challenge = service.readIncomingChallenge();
  startCountdown();
  await render();
}

main().catch((err: unknown) => {
  console.error('[splash] failed', err);
  $('track-name').textContent = 'Tap RACE to play';
});

window.addEventListener('pagehide', () => {
  preview.dispose();
  if (countdownTimer) clearInterval(countdownTimer);
});
