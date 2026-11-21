/**
 * GameApp — wires the Phaser RaceScene, the DOM UI and the LeaderboardService.
 *
 * Modes:
 *   daily      today's circuit, ranked
 *   challenge  a specific player's ghost locked onto the grid (head-to-head)
 *   champ      yesterday's circuit vs yesterday's #1 ("Challenge Yesterday's Champ")
 *   archive    an older daily post's circuit (practice, not ranked)
 *   alltime    a permanent circuit with an all-time leaderboard (always ranked)
 */
import Phaser from 'phaser';
import { GHOST_SLOTS, GHOST_STYLE, createPhaserConfig, type GhostSlot } from '../game/config';
import { SynthAudio } from '../game/audio/SynthAudio';
import { GhostTimeline } from '../game/ghost/GhostTimeline';
import { InputController } from '../game/input/InputController';
import { RaceScene, type FrameInfo, type RunResult } from '../game/scenes/RaceScene';
import { PERMANENT_CIRCUITS, isPermanent, permanentCircuit } from '../game/track/Circuits';
import { generateTrack } from '../game/track/TrackGenerator';
import type { Track } from '../game/track/TrackTypes';
import { dateKeyToMs, formatDateLabel, msUntilNextUtcDay, shiftDateKey } from '../game/util/date';
import { LeaderboardService } from '../services/LeaderboardService';
import {
  IS_DEVVIT,
  copyText,
  ensureRunAsUser,
  openPost,
  promptLogin,
  shareChallenge,
} from '../services/platform';
import { readJson, writeJson } from '../services/storage';
import {
  formatTime,
  fromChallengeCode,
  toChallengeCode,
  type LeaderboardEntry,
  type LeaderboardResponse,
  type RunRecord,
} from '../shared/api';
import { h } from '../ui/dom';
import { Hud, type GhostChipState } from '../ui/Hud';
import { MainMenu } from '../ui/MainMenu';
import { LeaderboardPanel, setNamePrefix } from '../ui/LeaderboardPanel';
import { PostRunModal, type Celebration, type PostRunView } from '../ui/PostRunModal';
import { SettingsModal, type Settings } from '../ui/SettingsModal';
import { ShareModal } from '../ui/ShareModal';
import { Toaster } from '../ui/Toast';
import { TouchControls } from '../ui/TouchControls';

type Mode =
  | { kind: 'daily'; date: string }
  | { kind: 'archive'; date: string }
  | { kind: 'alltime'; date: string }
  | { kind: 'champ'; date: string; run: RunRecord }
  | { kind: 'challenge'; date: string; run: RunRecord };

type LoadedGhost = { run: RunRecord; name: string };

const VIS_KEY = 'gc:v1:ghost-visibility';
const SETTINGS_KEY = 'gc:v1:settings';

const isVisibility = (v: unknown): v is Record<GhostSlot, boolean> =>
  !!v && typeof v === 'object' && GHOST_SLOTS.every((s) => typeof (v as Record<string, unknown>)[s] === 'boolean');
const isSettings = (v: unknown): v is Settings =>
  !!v && typeof v === 'object' && 'startMode' in v && (v.startMode === 'instant' || v.startMode === 'countdown');

export class GameApp {
  private readonly service = new LeaderboardService();
  private readonly audio = new SynthAudio();
  private readonly input: InputController;
  private readonly gameEl: HTMLElement;
  private readonly uiEl: HTMLElement;
  private readonly loadingEl: HTMLElement;
  private game: Phaser.Game | null = null;
  private scene: RaceScene | null = null;
  private hud: Hud | null = null;
  private touch: TouchControls | null = null;
  private postRun: PostRunModal | null = null;
  private panel: LeaderboardPanel | null = null;
  private shareModal: ShareModal | null = null;
  private settingsModal: SettingsModal | null = null;
  private toaster: Toaster | null = null;
  private menu: MainMenu | null = null;
  private showMenuOnReady = false;

  private mode: Mode = { kind: 'daily', date: '' };
  private track: Track | null = null;
  private readonly ghosts: Partial<Record<GhostSlot, LoadedGhost>> = {};
  private visibility: Record<GhostSlot, boolean>;
  private settings: Settings;
  private leaderboard: LeaderboardResponse | null = null;
  private ghostToken = 0;
  private lastResult: RunResult | null = null;
  /** Run id the server assigned to lastResult (if it was stored). */
  private lastRunId: string | null = null;
  private shareTarget: { runId: string; timeMs: number; date: string } | null = null;
  private readonly disposers: Array<() => void> = [];
  private rolloverTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(private readonly root: HTMLElement) {
    this.gameEl = h('div', { class: 'game-canvas' });
    this.uiEl = h('div', { class: 'ui-layer' });
    this.loadingEl = h('div', { class: 'loading' }, h('div', { class: 'loading-logo', text: 'GHOST CIRCUIT' }), h('div', { class: 'loading-sub', text: 'Generating today’s circuit…' }));
    root.append(this.gameEl, this.uiEl, this.loadingEl);
    this.visibility = readJson(VIS_KEY, isVisibility) ?? { pb: true, record: true, champ: true, challenger: true };
    this.settings = readJson(SETTINGS_KEY, isSettings) ?? { startMode: 'instant' };
    this.input = new InputController({
      onRestart: () => this.retry(),
      onEscape: () => this.closeTopModal(),
      onAnyMovement: () => this.scene?.requestStart(),
    });
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.buildUi();
    this.service.onModeChange = () => this.hud?.setOffline(true);
    await this.service.init();
    this.hud?.setOffline(this.service.mode === 'offline');
    setNamePrefix(this.service.platform === 'local' ? '' : 'u/');

    const today = this.service.today();
    let mode: Mode = { kind: 'daily', date: today };
    const incoming = this.service.readIncomingChallenge();
    if (incoming) {
      const run = await this.service.getRun(incoming.runId);
      if (run && run.dateKey === incoming.date) mode = { kind: 'challenge', date: run.dateKey, run };
      else this.toaster?.show('That challenge has expired — racing today’s circuit', 'bad');
    } else if (this.service.postDateKey && this.service.postDateKey !== today) {
      const postMs = dateKeyToMs(this.service.postDateKey);
      if (postMs < dateKeyToMs(today)) mode = { kind: 'archive', date: this.service.postDateKey };
    }

    this.mode = mode;
    this.track = generateTrack(mode.date);
    this.hud?.setTrack(this.track, this.nextDailyAt(mode.date));
    this.buildMenu(today);
    this.showMenuOnReady = mode.kind === 'daily' && !new URLSearchParams(location.search).has('autopilot');

    const scene = new RaceScene(
      {
        onReady: (s) => this.onSceneReady(s),
        onFrame: (f) => this.onFrame(f),
        onStart: () => this.onRaceStart(),
        onCheckpoint: (i, t, dPb, dT, slot) => this.onCheckpoint(i, t, dPb, dT, slot),
        onFinish: (r) => void this.onFinish(r),
        onRestart: () => this.onRestarted(),
      },
      this.input,
      this.audio,
      this.track,
    );
    scene.setStartMode(this.settings.startMode);
    this.game = new Phaser.Game(createPhaserConfig(Phaser, this.gameEl, [scene]));

    const onVis = (): void => this.audio.setSuspended(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    this.disposers.push(() => document.removeEventListener('visibilitychange', onVis));
    this.rolloverTimer = setInterval(() => this.checkRollover(), 20_000);
  }

  private buildUi(): void {
    const ui = this.uiEl;
    this.toaster = new Toaster(ui);
    this.hud = new Hud(ui, {
      onMenu: () => this.openMenu(),
      onToggleGhost: (slot) => this.toggleGhost(slot),
      onToggleMute: () => {
        this.audio.unlock();
        this.audio.setMuted(!this.audio.muted);
        this.hud?.setMuted(this.audio.muted);
      },
      onLeaderboard: () => this.openPanel(),
      onRestart: () => this.retry(),
      onSettings: () => {
        this.settingsModal?.show(this.settings);
        this.syncInputEnabled();
      },
      onBannerAction: () => this.bannerAction(),
    });
    this.hud.setMuted(this.audio.muted);
    this.touch = new TouchControls(ui, this.input);
    this.postRun = new PostRunModal(ui, {
      onRetry: () => this.retry(),
      onChamp: () => void this.challengeChamp(),
      onShare: () => void this.shareLastRun(),
      onRace: (e, date) => void this.raceEntry(e, date),
      onShareMine: (e, date) => this.shareEntry(e, date),
      onNoteAction: () => this.noteAction(),
      onClose: () => {
        this.postRun?.hide();
        this.syncInputEnabled();
      },
    });
    this.panel = new LeaderboardPanel(ui, {
      load: (date) => this.service.getLeaderboard(date, 10),
      onRace: (e, date) => void this.raceEntry(e, date),
      onShareMine: (e, date) => this.shareEntry(e, date),
      onCode: (code) => void this.raceCode(code),
      onRename:
        this.service.platform === 'local' || !IS_DEVVIT
          ? (name) => {
              const ok = this.service.setNickname(name);
              if (ok) {
                this.toaster?.show(`Racing as ${name}`, 'good');
                this.panel?.refresh();
              }
              return ok;
            }
          : null,
      onClose: () => this.closePanel(),
    });
    this.shareModal = new ShareModal(ui, {
      onCopy: (text) =>
        void copyText(text).then((ok) => this.toaster?.show(ok ? 'Copied — paste it in the comments!' : 'Copy failed — select the text manually', ok ? 'good' : 'bad')),
      onShareSheet: () => void this.openShareSheet(),
      onComment: (e) => void this.postComment(e),
      onClose: () => {
        this.shareModal?.hide();
        this.syncInputEnabled();
      },
    });
    this.settingsModal = new SettingsModal(ui, {
      onChange: (s) => {
        this.settings = s;
        writeJson(SETTINGS_KEY, s);
        this.scene?.setStartMode(s.startMode);
      },
      onClose: () => {
        this.settingsModal?.hide();
        this.syncInputEnabled();
      },
    });
  }

  private onSceneReady(scene: RaceScene): void {
    this.scene = scene;
    if (new URLSearchParams(location.search).has('autopilot')) {
      scene.setAutopilot(true);
      this.scheduleAutoStart();
    }
    this.loadingEl.classList.add('gone');
    for (const slot of GHOST_SLOTS) scene.setGhostVisible(slot, this.visibility[slot]);
    this.applyModeUi();
    void this.loadGhosts();
    if (this.showMenuOnReady) this.openMenu();
  }

  // ── Main menu ─────────────────────────────────────────────────────────────

  private nextDailyAt(circuit: string): number | null {
    return isPermanent(circuit) ? null : Date.now() + msUntilNextUtcDay(this.service.now());
  }

  private buildMenu(today: string): void {
    const todayTrack = generateTrack(today);
    this.menu = new MainMenu(
      this.uiEl,
      [
        {
          id: today,
          kind: 'daily',
          name: todayTrack.name,
          tag: `DAILY · #${todayTrack.circuitNo}`,
          tagline: 'New circuit every day at 00:00 UTC. Today’s board only.',
          track: todayTrack,
        },
        ...PERMANENT_CIRCUITS.map((c) => ({
          id: c.id,
          kind: 'alltime' as const,
          name: c.name,
          tag: 'ALL-TIME',
          tagline: c.tagline,
          track: generateTrack(c.id),
        })),
      ],
      {
        onRace: (id) => {
          this.audio.unlock();
          this.audio.click();
          this.menu?.hide();
          this.setMode(isPermanent(id) ? { kind: 'alltime', date: id } : { kind: 'daily', date: id });
        },
        onBoards: (id) => this.openPanel(id),
        onHelp: () => {
          this.settingsModal?.show(this.settings);
          this.syncInputEnabled();
        },
        nextDailyAt: () => Date.now() + msUntilNextUtcDay(this.service.now()),
      },
    );
  }

  private openMenu(): void {
    const menu = this.menu;
    if (!menu) return;
    this.postRun?.hide();
    this.shareModal?.hide();
    this.closePanel();
    menu.setPlayer(this.service.username ? this.displayName(this.service.username) : 'GUEST (LOG IN TO RANK)');
    menu.show();
    this.scene?.restart(false);
    this.syncInputEnabled();
    const today = this.service.today();
    for (const id of [today, ...PERMANENT_CIRCUITS.map((c) => c.id)]) {
      this.service
        .getLeaderboard(id, 1)
        .then((lb) => {
          const top = lb.entries[0];
          const mine = lb.me?.timeMs ?? this.service.getPersonalBest(id)?.timeMs ?? null;
          this.menu?.setStats(id, {
            record: top ? `${formatTime(top.timeMs)} ${top.bot ? top.username : this.displayName(top.username)}` : null,
            mine: mine === null ? null : `${formatTime(mine)}${lb.me ? ` (#${lb.me.rank})` : ''}`,
            racers: lb.total,
          });
        })
        .catch(() => undefined);
    }
  }

  // ── Modes & ghosts ────────────────────────────────────────────────────────

  private get ranked(): boolean {
    return this.mode.kind !== 'archive' && this.service.isRanked(this.mode.date);
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    const scene = this.scene;
    if (!scene) return;
    if (!this.track || this.track.dateKey !== mode.date) {
      this.track = generateTrack(mode.date);
      scene.loadTrack(this.track);
      this.hud?.setTrack(this.track, this.nextDailyAt(mode.date));
    } else {
      scene.restart(true);
    }
    for (const slot of GHOST_SLOTS) delete this.ghosts[slot];
    this.postRun?.hide();
    this.closePanel();
    this.shareModal?.hide();
    this.syncInputEnabled();
    this.applyModeUi();
    void this.loadGhosts();
  }

  private applyModeUi(): void {
    const m = this.mode;
    const hud = this.hud;
    if (!hud) return;
    if (m.kind === 'challenge') {
      hud.setBanner(`⚔ Head-to-head vs ${this.displayName(m.run.username)} · ${formatTime(m.run.timeMs)}`, 'Exit challenge', 'challenge');
    } else if (m.kind === 'champ') {
      hud.setBanner(`Yesterday’s circuit · beat ${this.displayName(m.run.username)}’s ${formatTime(m.run.timeMs)}`, 'Back to today', 'champ');
    } else if (m.kind === 'archive') {
      hud.setBanner(`Archived circuit (${formatDateLabel(m.date)}) · practice only`, 'Race today’s circuit', 'archive');
    } else {
      hud.setBanner(null, null);
    }
  }

  private displayName(username: string): string {
    return username === 'PACE BOT' || this.service.platform === 'local' ? username : `u/${username}`;
  }

  private bannerAction(): void {
    if (this.mode.kind === 'archive' && IS_DEVVIT && this.service.todayPostId) {
      openPost(this.service.todayPostId);
      return;
    }
    // Leaving a challenge on an all-time circuit keeps you on that circuit.
    if (this.mode.kind === 'challenge' && isPermanent(this.mode.date)) {
      this.setMode({ kind: 'alltime', date: this.mode.date });
      return;
    }
    this.setMode({ kind: 'daily', date: this.service.today() });
  }

  private checkRollover(): void {
    const today = this.service.today();
    if (this.mode.kind === 'daily' && this.mode.date !== today) {
      this.hud?.setBanner('🏁 A new circuit is live!', 'Race it', 'info');
    }
  }

  /** Populate the ghost roster for the current mode. */
  private async loadGhosts(): Promise<void> {
    const track = this.track;
    const scene = this.scene;
    if (!track || !scene) return;
    const token = ++this.ghostToken;
    const date = track.dateKey;
    const stale = (): boolean => token !== this.ghostToken || this.disposed;
    for (const slot of GHOST_SLOTS) scene.setGhost(slot, null, '');

    // Personal best (local cache first, server second).
    const pb = this.service.getPersonalBest(date);
    if (pb) this.setGhostRun('pb', { id: pb.runId ?? 'local', username: this.service.username ?? 'you', dateKey: date, timeMs: pb.timeMs, ghostData: pb.ghostData, createdAt: 0 }, 'PB');

    let lb: LeaderboardResponse | null = null;
    try {
      lb = await this.service.getLeaderboard(date, 10);
    } catch {
      lb = null;
    }
    if (stale()) return;
    this.leaderboard = lb;

    if (lb?.me?.runId && (!pb || lb.me.timeMs < pb.timeMs)) {
      const run = await this.service.getRun(lb.me.runId);
      if (stale()) return;
      if (run) {
        this.setGhostRun('pb', run, 'PB');
        this.service.savePersonalBest(date, { timeMs: run.timeMs, ghostData: run.ghostData, runId: run.id });
      }
    }

    const top = lb?.entries[0];
    const me = this.service.username;
    const m = this.mode;
    const versusId = m.kind === 'challenge' || m.kind === 'champ' ? m.run.id : null;
    if (top && top.runId && top.username !== me && top.runId !== versusId) {
      const run = await this.service.getRun(top.runId);
      if (stale()) return;
      if (run) this.setGhostRun('record', run, `#1 ${this.displayName(run.username)}`);
    } else if (!top) {
      const pace = this.service.paceRun(date);
      if (pace) this.setGhostRun('record', pace, '#1 PACE BOT');
    }

    if (m.kind === 'challenge') this.setGhostRun('challenger', m.run, `CHALLENGER ${this.displayName(m.run.username)}`);
    if (m.kind === 'champ') this.setGhostRun('champ', m.run, `YESTERDAY'S CHAMP ${this.displayName(m.run.username)}`);
    this.updateChips();
  }

  private setGhostRun(slot: GhostSlot, run: RunRecord, label: string): boolean {
    const track = this.track;
    if (!track || !this.scene) return false;
    const frames = this.service.validGhost(track, run.timeMs, run.ghostData);
    if (!frames) {
      console.warn(`[ghost] rejected ${slot} ghost ${run.id}: failed validation`);
      return false;
    }
    this.scene.setGhost(slot, new GhostTimeline(frames, track), label);
    this.ghosts[slot] = { run, name: run.username };
    this.updateChips();
    return true;
  }

  private updateChips(): void {
    const states = {} as Record<GhostSlot, GhostChipState>;
    for (const slot of GHOST_SLOTS) {
      const g = this.ghosts[slot];
      const style = GHOST_STYLE[slot];
      states[slot] = {
        available: !!g,
        visible: this.visibility[slot],
        title: g ? `${style.label}: ${this.displayName(g.name)} ${formatTime(g.run.timeMs)}` : `${style.label}: none`,
      };
    }
    this.hud?.setGhostChips(states);
  }

  private toggleGhost(slot: GhostSlot): void {
    this.visibility[slot] = !this.visibility[slot];
    writeJson(VIS_KEY, this.visibility);
    this.scene?.setGhostVisible(slot, this.visibility[slot]);
    this.updateChips();
    this.audio.click();
  }

  // ── Race events ───────────────────────────────────────────────────────────

  private onFrame(f: FrameInfo): void {
    this.hud?.update(f);
  }

  private onRaceStart(): void {
    this.lastResult = null;
    this.lastRunId = null;
  }

  private onCheckpoint(index: number, _timeMs: number, dPb: number | null, dTarget: number | null, slot: GhostSlot | null): void {
    const total = this.track?.checkpoints.length ?? 0;
    const cp = index + 1 >= total ? 'FINAL CP' : `CP ${index + 1}`;
    // Name the ghost the split is measured against, so "+0.300" is never ambiguous.
    if (dTarget !== null && slot) this.hud?.showSplit(`${cp} · ${GHOST_STYLE[slot].short}`, dTarget, GHOST_STYLE[slot].css);
    else if (dPb !== null) this.hud?.showSplit(`${cp} · PB`, dPb, GHOST_STYLE.pb.css);
    else this.hud?.showSplit(cp, null, GHOST_STYLE.pb.css);
  }

  private scheduleAutoStart(): void {
    setTimeout(() => {
      if (this.scene?.autopilot && this.scene.status === 'ready') this.scene.requestStart();
    }, 700);
  }

  private onRestarted(): void {
    if (this.scene?.autopilot) this.scheduleAutoStart();
    this.postRun?.hide();
    this.shareModal?.hide();
    this.syncInputEnabled();
  }

  private retry(): void {
    if (this.menu?.isOpen) return;
    this.audio.unlock();
    this.closePanel();
    this.settingsModal?.hide();
    this.shareModal?.hide();
    this.postRun?.hide();
    this.syncInputEnabled();
    this.scene?.restart(true);
  }

  private async onFinish(result: RunResult): Promise<void> {
    const track = this.track;
    if (!track) return;
    this.lastResult = result;
    this.lastRunId = null;
    const date = track.dateKey;
    const ranked = this.ranked;
    const me = this.service.username;
    const yesterdayAvailable = this.mode.kind !== 'champ' && !isPermanent(date);
    const allTime = isPermanent(date);

    const localPb = this.service.getPersonalBest(date)?.timeMs ?? null;
    const serverPb = this.leaderboard?.me?.timeMs ?? null;
    const prevPbMs = localPb === null ? serverPb : serverPb === null ? localPb : Math.min(localPb, serverPb);
    const finished = result.status === 'finished';
    const isPb = finished && (prevPbMs === null || result.timeMs < prevPbMs);

    const versusGhost = this.mode.kind === 'challenge' ? this.ghosts.challenger : this.mode.kind === 'champ' ? this.ghosts.champ : undefined;
    const versus = versusGhost
      ? { slot: (this.mode.kind === 'challenge' ? 'challenger' : 'champ') as GhostSlot, name: this.displayName(versusGhost.name), timeMs: versusGhost.run.timeMs }
      : null;

    const deltas: PostRunView['deltas'] = [];
    if (finished) {
      if (prevPbMs !== null) deltas.push({ slot: 'pb', label: 'vs PB', deltaMs: result.timeMs - prevPbMs });
      const rec = this.ghosts.record;
      if (rec) deltas.push({ slot: 'record', label: rec.name === 'PACE BOT' ? 'vs PACE' : 'vs #1', deltaMs: result.timeMs - rec.run.timeMs });
      if (versusGhost && versus) deltas.push({ slot: versus.slot, label: `vs ${versusGhost.name}`, deltaMs: result.timeMs - versusGhost.run.timeMs });
    }

    const beatVersus = !!versus && finished && result.timeMs < versus.timeMs;
    let celebration: Celebration = finished ? 'finish' : 'dnf';
    if (finished) {
      if (this.mode.kind === 'challenge') celebration = beatVersus ? 'challenge' : 'defeat';
      else if (this.mode.kind === 'champ') celebration = beatVersus ? 'victory' : 'defeat';
      if (isPb && celebration !== 'challenge' && celebration !== 'victory') celebration = 'pb';
    }
    if (beatVersus) this.audio.record();

    // Save a local PB right away so the next retry races it (practice dates too).
    if (isPb && result.ghostData) {
      this.service.savePersonalBest(date, { timeMs: result.timeMs, ghostData: result.ghostData, runId: null });
      this.setGhostRun('pb', { id: 'local', username: me ?? 'you', dateKey: date, timeMs: result.timeMs, ghostData: result.ghostData, createdAt: Date.now() }, 'PB');
    }

    const canSubmit = ranked && finished && !!result.ghostData;
    const loggedOut = IS_DEVVIT && !me;
    const view: PostRunView = {
      status: result.status,
      timeMs: result.timeMs,
      checkpointsCleared: result.checkpointsCleared,
      checkpointTotal: track.checkpoints.length,
      celebration,
      versus,
      deltas,
      standing: this.leaderboard?.me
        ? { rank: this.leaderboard.me.rank, total: this.leaderboard.total, gapToNextMs: this.leaderboard.me.gapToNextMs, nextUsername: this.leaderboard.me.nextUsername }
        : null,
      note: !ranked ? 'Practice run — only today’s circuit is ranked.' : loggedOut ? 'Log in to put your time on the board.' : isPb ? 'Saving your time…' : null,
      noteAction: !ranked ? 'Race today’s circuit' : loggedOut ? 'Log in' : null,
      leaderboard: this.leaderboard,
      leaderboardLoading: canSubmit && isPb && !loggedOut,
      me,
      canShare: ranked && finished && !loggedOut,
      champLabel: yesterdayAvailable ? "Challenge Yesterday's Champ" : null,
      ranked,
      boardTitle: allTime ? `Top 10 all-time · ${permanentCircuit(date)?.name ?? ''}` : 'Top 10 today',
      rankedText: allTime ? 'ranked on the all-time board' : 'ranked on today’s circuit',
    };
    this.postRun?.show(view);
    this.syncInputEnabled();

    if (!canSubmit || !isPb || loggedOut || !result.ghostData) return;
    const res = await this.service.submitRun({ dateKey: date, timeMs: result.timeMs, ghostData: result.ghostData });
    if (this.lastResult !== result) return;
    if (!res.accepted) {
      this.postRun?.update({ note: `Not saved: ${res.reason}`, leaderboardLoading: false });
      return;
    }
    this.lastRunId = res.run.id;
    this.leaderboard = res.leaderboard;
    const meRow = res.leaderboard.me;
    const record = res.isRecord;
    if (record) this.audio.record();
    this.postRun?.update({
      celebration: record ? 'record' : celebration === 'challenge' || celebration === 'victory' ? celebration : 'pb',
      note: this.service.mode === 'offline' ? 'Saved to the offline leaderboard.' : null,
      leaderboard: res.leaderboard,
      leaderboardLoading: false,
      standing: meRow ? { rank: meRow.rank, total: res.leaderboard.total, gapToNextMs: meRow.gapToNextMs, nextUsername: meRow.nextUsername } : null,
    });
    if (res.isPersonalBest) this.setGhostRun('pb', { ...res.run, ghostData: result.ghostData }, 'PB');
    if (record) {
      // You are the new #1: the gold ghost would just duplicate your PB.
      this.scene?.setGhost('record', null, '');
      delete this.ghosts.record;
      this.updateChips();
    }
    this.panel?.refresh();
  }

  private noteAction(): void {
    if (!this.ranked) {
      this.setMode({ kind: 'daily', date: this.service.today() });
      return;
    }
    if (IS_DEVVIT && !this.service.username) promptLogin();
  }

  // ── Challenges ────────────────────────────────────────────────────────────

  private async challengeChamp(): Promise<void> {
    const run = await this.service.loadYesterdayChampion();
    if (!run) {
      this.toaster?.show('No champion for yesterday’s circuit yet', 'bad');
      return;
    }
    this.setMode({ kind: 'champ', date: run.dateKey, run });
    this.toaster?.show(`Beat ${this.displayName(run.username)}’s ${formatTime(run.timeMs)} on yesterday’s circuit`, 'info');
  }

  private async raceEntry(entry: LeaderboardEntry, _date: string): Promise<void> {
    if (!entry.runId) return;
    const run = await this.service.getRun(entry.runId);
    if (!run) {
      this.toaster?.show('That ghost is no longer available', 'bad');
      return;
    }
    this.raceRun(run);
  }

  private raceRun(run: RunRecord): void {
    this.setMode({ kind: 'challenge', date: run.dateKey, run });
    this.toaster?.show(`Racing ${this.displayName(run.username)}’s ghost · ${formatTime(run.timeMs)}`, 'info');
  }

  private async raceCode(code: string): Promise<void> {
    const id = fromChallengeCode(code);
    if (!id) {
      this.toaster?.show('That doesn’t look like a challenge code (GC-XXXXXXXX)', 'bad');
      return;
    }
    const run = await this.service.getRun(id);
    if (!run) {
      this.toaster?.show('Challenge not found (codes expire after 10 days)', 'bad');
      return;
    }
    this.raceRun(run);
  }

  private shareEntry(entry: LeaderboardEntry, date: string): void {
    if (!entry.runId) return;
    this.openShare({ runId: entry.runId, timeMs: entry.timeMs, date });
  }

  private async shareLastRun(): Promise<void> {
    const r = this.lastResult;
    const track = this.track;
    if (!r || r.status !== 'finished' || !r.ghostData || !track) return;
    let runId = this.lastRunId;
    if (!runId) {
      const res = await this.service.submitRun({ dateKey: track.dateKey, timeMs: r.timeMs, ghostData: r.ghostData, share: true });
      if (!res.accepted) {
        this.toaster?.show(`Couldn’t create a challenge: ${res.reason}`, 'bad');
        return;
      }
      runId = res.run.id;
      this.lastRunId = runId;
    }
    this.openShare({ runId, timeMs: r.timeMs, date: track.dateKey });
  }

  private openShare(target: { runId: string; timeMs: number; date: string }): void {
    this.shareTarget = target;
    const track = generateTrack(target.date);
    const code = toChallengeCode(target.runId);
    const link = IS_DEVVIT ? null : this.service.encodeChallengeUrl(target.date, target.runId);
    const snippet = this.service.shareSnippet(target.timeMs, track, link ?? `Challenge code: ${code}`);
    this.shareModal?.show({
      snippet,
      code,
      link,
      canShareSheet: IS_DEVVIT,
      canComment: IS_DEVVIT && this.service.mode === 'online' && !!this.service.username,
    });
    this.syncInputEnabled();
  }

  private async openShareSheet(): Promise<void> {
    const t = this.shareTarget;
    if (!t) return;
    const track = generateTrack(t.date);
    const ok = await shareChallenge(
      { date: t.date, runId: t.runId },
      `Beat my ${formatTime(t.timeMs)} on Ghost Circuit`,
      this.service.shareSnippet(t.timeMs, track, null),
    );
    if (!ok) this.toaster?.show('Sharing isn’t available here — use Copy instead', 'bad');
  }

  private async postComment(event: MouseEvent): Promise<void> {
    const t = this.shareTarget;
    if (!t) return;
    const allowed = await ensureRunAsUser(event);
    if (!allowed) {
      this.toaster?.show('Reddit didn’t allow commenting — use Copy and paste it instead', 'bad');
      return;
    }
    const res = await this.service.postChallengeComment(t.runId);
    this.toaster?.show(res.ok ? 'Challenge posted to the comments!' : `Couldn’t comment: ${res.reason ?? 'unknown error'}`, res.ok ? 'good' : 'bad');
    if (res.ok) {
      this.shareModal?.hide();
      this.syncInputEnabled();
    }
  }

  // ── Panels ────────────────────────────────────────────────────────────────

  /** Open the leaderboards on a given circuit's tab (default: the one being raced). */
  private openPanel(focus?: string): void {
    const today = this.service.today();
    const tabs = [
      { label: this.mode.kind === 'archive' ? formatDateLabel(this.mode.date) : 'Today', date: this.mode.kind === 'archive' ? this.mode.date : today },
      { label: 'Yesterday', date: shiftDateKey(today, -1) },
      ...PERMANENT_CIRCUITS.map((c) => ({ label: c.short, date: c.id })),
    ];
    const active = Math.max(0, tabs.findIndex((t) => t.date === (focus ?? this.mode.date)));
    this.panel?.open(tabs, active, this.service.username);
    this.syncInputEnabled();
  }

  private closePanel(): void {
    this.panel?.close();
    this.syncInputEnabled();
  }

  private closeTopModal(): void {
    if (this.shareModal?.isOpen) this.shareModal.hide();
    else if (this.settingsModal?.isOpen) this.settingsModal.hide();
    else if (this.panel?.isOpen) this.panel.close();
    else if (this.postRun?.isOpen) this.postRun.hide();
    this.syncInputEnabled();
  }

  /** Driving input is disabled while any overlay is open (R still restarts). */
  private syncInputEnabled(): void {
    const blocked = !!(
      this.menu?.isOpen || this.shareModal?.isOpen || this.settingsModal?.isOpen || this.panel?.isOpen || this.postRun?.isOpen
    );
    this.input.enabled = !blocked;
    this.root.classList.toggle('overlay-open', blocked);
  }

  // ── Teardown ──────────────────────────────────────────────────────────────

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rolloverTimer) clearInterval(this.rolloverTimer);
    for (const d of this.disposers.splice(0)) d();
    this.input.dispose();
    this.touch?.dispose();
    this.hud?.dispose();
    this.postRun?.dispose();
    this.panel?.dispose();
    this.shareModal?.dispose();
    this.settingsModal?.dispose();
    this.menu?.dispose();
    this.toaster?.dispose();
    this.game?.destroy(true);
    this.game = null;
    this.scene = null;
    this.audio.dispose();
  }
}
