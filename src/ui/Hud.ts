/**
 * In-race HUD (DOM overlay):
 *   top-left   date badge + circuit name, checkpoint counter, minimap
 *   top-center big race clock (urgency pulse in the last 10s) + live deltas
 *   top-right  ghost toggles, mute, leaderboard, restart
 *   center     start hint / countdown / split pop-ups
 */
import { GHOST_SLOTS, GHOST_STYLE, MAX_TIME_MS, type GhostSlot } from '../game/config';
import type { FrameInfo } from '../game/scenes/RaceScene';
import type { Track } from '../game/track/TrackTypes';
import { isPermanent } from '../game/track/Circuits';
import { formatCountdown, formatDateLabel } from '../game/util/date';
import { formatDelta, formatTime } from '../shared/api';
import { h, icon, isTouchDevice, listen, setText, toggleClass } from './dom';
import { Minimap } from './Minimap';

export type HudCallbacks = {
  onMenu: () => void;
  onToggleGhost: (slot: GhostSlot) => void;
  onToggleMute: () => void;
  onLeaderboard: () => void;
  onRestart: () => void;
  onSettings: () => void;
  onBannerAction: () => void;
};

export type GhostChipState = { available: boolean; visible: boolean; title: string };

export class Hud {
  readonly root: HTMLElement;
  private readonly dateBadge: HTMLElement;
  private readonly trackName: HTMLElement;
  private readonly cpCounter: HTMLElement;
  private readonly timerMain: HTMLElement;
  private readonly timerBox: HTMLElement;
  private readonly deltaPb: HTMLElement;
  private readonly deltaTarget: HTMLElement;
  private readonly deltaTargetLabel: HTMLElement;
  private readonly deltaPbValue: HTMLElement;
  private readonly deltaTargetValue: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly hintNext: HTMLElement;
  private readonly countdown: HTMLElement;
  private readonly split: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly bannerText: HTMLElement;
  private readonly bannerBtn: HTMLButtonElement;
  private readonly offline: HTMLElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly chips = new Map<GhostSlot, HTMLButtonElement>();
  private readonly minimap = new Minimap(118);
  private readonly removers: Array<() => void> = [];
  private splitTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCountdownText = '';
  private nextDayAt: number | null = 0;

  constructor(parent: HTMLElement, cb: HudCallbacks) {
    this.dateBadge = h('span', { class: 'badge-date' });
    this.trackName = h('span', { class: 'badge-name' });
    this.cpCounter = h('div', { class: 'cp-counter', text: 'CP 0/0' });
    this.offline = h('div', { class: 'offline-badge', title: 'The leaderboard server is unreachable — playing against the local leaderboard', text: 'OFFLINE · LOCAL BOARD' });

    this.timerMain = h('span', { class: 't-main', text: '00.000' });
    this.timerBox = h('div', { class: 'timer' }, this.timerMain, h('span', { class: 't-limit', text: `/ ${formatTime(MAX_TIME_MS)}` }));
    this.deltaPbValue = h('span', { class: 'd-val', text: '—' });
    this.deltaPb = h('div', { class: 'delta delta-pb' }, h('span', { class: 'd-label', text: 'PB' }), this.deltaPbValue);
    this.deltaTargetLabel = h('span', { class: 'd-label', text: '#1' });
    this.deltaTargetValue = h('span', { class: 'd-val', text: '—' });
    this.deltaTarget = h('div', { class: 'delta delta-target' }, this.deltaTargetLabel, this.deltaTargetValue);

    const chipRow = h('div', { class: 'ghost-chips', role: 'group', 'aria-label': 'Ghost visibility' });
    for (const slot of GHOST_SLOTS) {
      const style = GHOST_STYLE[slot];
      const chip = h(
        'button',
        { class: 'chip', type: 'button', 'aria-pressed': 'true', disabled: true, title: style.label },
        h('i', { class: 'chip-dot' }),
        style.short,
      );
      chip.style.setProperty('--chip', style.css);
      this.removers.push(listen(chip, 'click', () => cb.onToggleGhost(slot)));
      this.chips.set(slot, chip);
      chipRow.append(chip);
    }

    this.muteBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Mute sound', title: 'Sound' });
    const menuBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Main menu', title: 'Menu' }, icon('menu'));
    const boardBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Leaderboard', title: 'Leaderboard' }, icon('trophy'));
    const gearBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Settings', title: 'Settings' }, icon('gear'));
    const restartBtn = h(
      'button',
      { class: 'icon-btn restart-btn', type: 'button', 'aria-label': 'Restart (R)', title: 'Restart (R)' },
      icon('restart'),
      h('kbd', { text: 'R' }),
    );
    this.removers.push(
      listen(menuBtn, 'click', () => cb.onMenu()),
      listen(this.muteBtn, 'click', () => cb.onToggleMute()),
      listen(boardBtn, 'click', () => cb.onLeaderboard()),
      listen(gearBtn, 'click', () => cb.onSettings()),
      listen(restartBtn, 'click', () => cb.onRestart()),
    );

    const touch = isTouchDevice();
    this.hintNext = h('div', { class: 'hint-next' });
    this.hint = h(
      'div',
      { class: 'start-hint' },
      h('div', { class: 'hint-main', text: touch ? 'Hold GAS to start' : 'Press ▲ / W to start' }),
      h('div', { class: 'hint-keys', text: touch ? 'Steer ◀ ▶ · DRIFT for tight turns · ⟲ to restart' : 'Steer ◀ ▶ / A D · SPACE drift · R restart' }),
      this.hintNext,
    );
    this.countdown = h('div', { class: 'countdown' });
    this.split = h('div', { class: 'split-pop' });

    this.bannerText = h('span', { class: 'banner-text' });
    this.bannerBtn = h('button', { class: 'banner-btn', type: 'button' });
    this.banner = h('div', { class: 'mode-banner hidden' }, this.bannerText, this.bannerBtn);
    this.removers.push(listen(this.bannerBtn, 'click', () => cb.onBannerAction()));

    this.root = h(
      'div',
      { class: 'hud' },
      h(
        'div',
        { class: 'hud-tl' },
        h('div', { class: 'badge' }, this.dateBadge, this.trackName),
        h('div', { class: 'hud-row' }, this.cpCounter, this.offline),
        this.minimap.el,
      ),
      h('div', { class: 'hud-tc' }, this.timerBox, h('div', { class: 'deltas' }, this.deltaPb, this.deltaTarget), this.banner),
      h('div', { class: 'hud-tr' }, chipRow, h('div', { class: 'hud-btns' }, menuBtn, this.muteBtn, boardBtn, gearBtn, restartBtn)),
      this.hint,
      this.countdown,
      this.split,
    );
    parent.append(this.root);
    this.setOffline(false);
  }

  /** nextDayAt: when the daily rolls over, or null for an all-time circuit. */
  setTrack(track: Track, nextDayAt: number | null): void {
    const perm = isPermanent(track.dateKey);
    this.dateBadge.replaceChildren(
      h('span', { class: `kind-badge small ${perm ? 'alltime' : 'daily'}`, text: perm ? 'Permanent' : 'Daily' }),
      perm ? ' All-time board' : ` ${formatDateLabel(track.dateKey)} · #${track.circuitNo}`,
    );
    if (this.dateBadge.parentElement) toggleClass(this.dateBadge.parentElement, 'perm', perm);
    setText(this.trackName, track.name);
    this.minimap.setTrack(track);
    this.nextDayAt = nextDayAt;
  }

  setMuted(muted: boolean): void {
    this.muteBtn.replaceChildren(icon(muted ? 'soundOff' : 'soundOn'));
    this.muteBtn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
    toggleClass(this.muteBtn, 'off', muted);
  }

  setOffline(on: boolean): void {
    toggleClass(this.offline, 'hidden', !on);
  }

  setGhostChips(states: Record<GhostSlot, GhostChipState>): void {
    for (const slot of GHOST_SLOTS) {
      const chip = this.chips.get(slot);
      const st = states[slot];
      if (!chip) continue;
      chip.disabled = !st.available;
      chip.setAttribute('aria-pressed', st.available && st.visible ? 'true' : 'false');
      chip.title = st.title;
      toggleClass(chip, 'off', !st.visible || !st.available);
      toggleClass(chip, 'absent', !st.available);
    }
  }

  setBanner(text: string | null, action: string | null, kind: 'champ' | 'challenge' | 'archive' | 'info' = 'info'): void {
    toggleClass(this.banner, 'hidden', !text);
    this.banner.dataset.kind = kind;
    setText(this.bannerText, text ?? '');
    this.bannerBtn.hidden = !action;
    setText(this.bannerBtn, action ?? '');
  }

  showSplit(label: string, deltaMs: number | null, slotCss: string): void {
    this.split.replaceChildren(h('span', { class: 'sp-label', text: label }));
    if (deltaMs !== null) {
      this.split.append(h('span', { class: `sp-delta ${deltaMs <= 0 ? 'ahead' : 'behind'}`, text: formatDelta(deltaMs) }));
    }
    this.split.style.setProperty('--slot', slotCss);
    this.split.classList.remove('show');
    void this.split.offsetWidth;
    this.split.classList.add('show');
    if (this.splitTimer) clearTimeout(this.splitTimer);
    this.splitTimer = setTimeout(() => this.split.classList.remove('show'), 1300);
  }

  update(f: FrameInfo): void {
    setText(this.timerMain, formatTime(f.elapsedMs));
    toggleClass(this.timerBox, 'urgent', f.status === 'racing' && f.elapsedMs >= MAX_TIME_MS - 10_000);
    toggleClass(this.timerBox, 'done', f.status === 'finished');
    setText(this.cpCounter, `CP ${Math.min(f.checkpointsCleared, f.checkpointTotal)}/${f.checkpointTotal}`);
    toggleClass(this.cpCounter, 'final', f.checkpointsCleared >= f.checkpointTotal && f.status === 'racing');

    this.renderDelta(this.deltaPb, this.deltaPbValue, f.deltaPb);
    if (f.targetSlot) {
      const style = GHOST_STYLE[f.targetSlot];
      setText(this.deltaTargetLabel, style.short);
      this.deltaTarget.style.setProperty('--slot', style.css);
    }
    toggleClass(this.deltaTarget, 'hidden', !f.targetSlot);
    this.renderDelta(this.deltaTarget, this.deltaTargetValue, f.deltaTarget);

    const ready = f.status === 'ready';
    toggleClass(this.hint, 'show', ready && f.countdown === null);
    if (ready) {
      const text =
        this.nextDayAt === null ? 'All-time board · never resets' : `Next circuit in ${formatCountdown(this.nextDayAt - Date.now())}`;
      if (text !== this.lastCountdownText) {
        this.lastCountdownText = text;
        setText(this.hintNext, text);
      }
    }
    const cd = f.countdown === null ? '' : f.countdown <= 0 ? 'GO!' : String(f.countdown);
    setText(this.countdown, cd);
    toggleClass(this.countdown, 'show', cd !== '');
    this.minimap.draw(f.carX, f.carY, f.ghosts, f.checkpointsCleared);
  }

  private renderDelta(box: HTMLElement, value: HTMLElement, delta: number | null): void {
    if (delta === null) {
      setText(value, '—');
      toggleClass(box, 'ahead', false);
      toggleClass(box, 'behind', false);
      return;
    }
    setText(value, formatDelta(delta));
    toggleClass(box, 'ahead', delta <= 0);
    toggleClass(box, 'behind', delta > 0);
  }

  dispose(): void {
    for (const r of this.removers.splice(0)) r();
    if (this.splitTimer) clearTimeout(this.splitTimer);
    this.root.remove();
  }
}
