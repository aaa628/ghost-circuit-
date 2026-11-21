/**
 * Post-run modal: final time + celebration state (NEW WORLD RECORD! / NEW PB! /
 * CHALLENGE BEATEN! / VICTORY / DEFEAT / TIME UP), millisecond deltas, rank and
 * gap, the top-10 board with a pinned player row, and the primary CTAs.
 */
import { GHOST_STYLE, type GhostSlot } from '../game/config';
import { formatDelta, formatGap, formatTime, type LeaderboardResponse } from '../shared/api';
import { h, icon, listen, setText } from './dom';
import { displayUser, renderLeaderboardList, type RaceGhostHandler } from './LeaderboardPanel';

export type Celebration = 'record' | 'pb' | 'challenge' | 'victory' | 'defeat' | 'dnf' | 'finish';

export type PostRunView = {
  status: 'finished' | 'dnf';
  timeMs: number;
  checkpointsCleared: number;
  checkpointTotal: number;
  celebration: Celebration;
  versus: { slot: GhostSlot; name: string; timeMs: number } | null;
  deltas: Array<{ slot: GhostSlot | 'prev'; label: string; deltaMs: number }>;
  standing: { rank: number; total: number; gapToNextMs: number | null; nextUsername: string | null } | null;
  note: string | null;
  noteAction: string | null;
  leaderboard: LeaderboardResponse | null;
  leaderboardLoading: boolean;
  me: string | null;
  canShare: boolean;
  champLabel: string | null;
  ranked: boolean;
};

export type PostRunCallbacks = {
  onRetry: () => void;
  onChamp: () => void;
  onShare: (event: MouseEvent) => void;
  onRace: RaceGhostHandler;
  onShareMine: RaceGhostHandler;
  onNoteAction: () => void;
  onClose: () => void;
};

const TITLES: Record<Celebration, string> = {
  record: 'NEW WORLD RECORD!',
  pb: 'NEW PB!',
  challenge: 'CHALLENGE BEATEN!',
  victory: 'VICTORY',
  defeat: 'DEFEAT',
  dnf: 'TIME UP',
  finish: 'FINISHED',
};

export class PostRunModal {
  readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private readonly title: HTMLElement;
  private readonly time: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly versus: HTMLElement;
  private readonly deltas: HTMLElement;
  private readonly standing: HTMLElement;
  private readonly note: HTMLElement;
  private readonly noteText: HTMLElement;
  private readonly noteBtn: HTMLButtonElement;
  private readonly board: HTMLElement;
  private readonly shareBtn: HTMLButtonElement;
  private readonly champBtn: HTMLButtonElement;
  private readonly champLabel: HTMLElement;
  private readonly removers: Array<() => void> = [];
  private view: PostRunView | null = null;

  constructor(parent: HTMLElement, private readonly cb: PostRunCallbacks) {
    this.title = h('div', { class: 'pr-title' });
    this.time = h('div', { class: 'pr-time' });
    this.sub = h('div', { class: 'pr-sub' });
    this.versus = h('div', { class: 'pr-versus' });
    this.deltas = h('div', { class: 'pr-deltas' });
    this.standing = h('div', { class: 'pr-standing' });
    this.noteText = h('span');
    this.noteBtn = h('button', { class: 'btn btn-small', type: 'button' });
    this.note = h('div', { class: 'pr-note' }, this.noteText, this.noteBtn);
    this.board = h('div', { class: 'lb-container pr-board' });

    const retryBtn = h('button', { class: 'btn btn-primary', type: 'button' }, icon('restart', 18), 'Retry', h('kbd', { text: 'R' }));
    this.champLabel = h('span', { text: "Challenge Yesterday's Champ" });
    this.champBtn = h('button', { class: 'btn btn-champ', type: 'button' }, icon('flag', 18), this.champLabel);
    this.shareBtn = h('button', { class: 'btn btn-share', type: 'button' }, icon('share', 18), 'Share & Challenge');
    const closeBtn = h('button', { class: 'icon-btn pr-close', type: 'button', 'aria-label': 'Close results' }, icon('close'));
    this.removers.push(
      listen(retryBtn, 'click', () => cb.onRetry()),
      listen(this.champBtn, 'click', () => cb.onChamp()),
      listen(this.shareBtn, 'click', (e) => cb.onShare(e)),
      listen(this.noteBtn, 'click', () => cb.onNoteAction()),
      listen(closeBtn, 'click', () => cb.onClose()),
    );

    this.card = h(
      'div',
      { class: 'pr-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Run results' },
      closeBtn,
      h('div', { class: 'pr-hero' }, this.title, this.time, this.sub, this.versus, this.deltas, this.standing, this.note),
      h('div', { class: 'pr-actions' }, retryBtn, this.shareBtn, this.champBtn),
      h('div', { class: 'pr-board-head', text: 'Top 10 today' }),
      this.board,
    );
    this.root = h('div', { class: 'modal-backdrop postrun hidden' }, this.card);
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(view: PostRunView): void {
    this.root.classList.remove('hidden');
    this.render(view);
    requestAnimationFrame(() => this.root.classList.add('in'));
  }

  update(patch: Partial<PostRunView>): void {
    if (!this.view) return;
    this.render({ ...this.view, ...patch });
  }

  hide(): void {
    this.root.classList.remove('in');
    this.root.classList.add('hidden');
  }

  private render(v: PostRunView): void {
    this.view = v;
    this.card.dataset.celebration = v.celebration;
    setText(this.title, TITLES[v.celebration]);
    setText(this.time, v.status === 'dnf' ? '60.000' : formatTime(v.timeMs));
    setText(
      this.sub,
      v.status === 'dnf'
        ? `Reached checkpoint ${v.checkpointsCleared}/${v.checkpointTotal} — so close. Press R and go again.`
        : v.ranked
          ? 'Seconds · ranked on today’s circuit'
          : 'Seconds · practice (archive circuits aren’t ranked)',
    );

    this.versus.replaceChildren();
    if (v.versus) {
      const style = GHOST_STYLE[v.versus.slot];
      const won = v.status === 'finished' && v.timeMs < v.versus.timeMs;
      this.versus.append(
        h(
          'div',
          { class: `vs-card ${won ? 'won' : 'lost'}` },
          h('div', { class: 'vs-side you' }, h('span', { class: 'vs-name', text: 'YOU' }), h('span', { class: 'vs-time', text: v.status === 'dnf' ? 'DNF' : formatTime(v.timeMs) })),
          h('div', { class: 'vs-mid', text: won ? 'WIN' : 'LOSS' }),
          h(
            'div',
            { class: 'vs-side them' },
            h('span', { class: 'vs-name', text: v.versus.name }),
            h('span', { class: 'vs-time', text: formatTime(v.versus.timeMs) }),
          ),
        ),
      );
      this.versus.style.setProperty('--slot', style.css);
    }

    this.deltas.replaceChildren(
      ...v.deltas.map((d) => {
        const css = d.slot === 'prev' ? '#9aa4d6' : GHOST_STYLE[d.slot].css;
        const el = h('span', { class: `pr-delta ${d.deltaMs <= 0 ? 'ahead' : 'behind'}` }, h('b', { text: d.label }), formatDelta(d.deltaMs));
        el.style.setProperty('--slot', css);
        return el;
      }),
    );

    if (v.standing) {
      const s = v.standing;
      const gap = s.gapToNextMs !== null && s.nextUsername ? ` · ${formatGap(s.gapToNextMs)}s behind ${displayUser(s.nextUsername)} (#${s.rank - 1})` : '';
      setText(this.standing, s.rank === 1 ? `#1 of ${s.total} — you hold the record` : `Rank #${s.rank} of ${s.total}${gap}`);
    } else {
      setText(this.standing, '');
    }

    this.note.hidden = !v.note;
    setText(this.noteText, v.note ?? '');
    this.noteBtn.hidden = !v.noteAction;
    setText(this.noteBtn, v.noteAction ?? '');

    this.shareBtn.hidden = !v.canShare;
    this.champBtn.hidden = !v.champLabel;
    if (v.champLabel) setText(this.champLabel, v.champLabel);

    renderLeaderboardList(
      this.board,
      v.leaderboard,
      v.me,
      { onRace: this.cb.onRace, onShareMine: this.cb.onShareMine },
      { loading: v.leaderboardLoading },
    );
  }

  dispose(): void {
    for (const r of this.removers.splice(0)) r();
    this.root.remove();
  }
}
