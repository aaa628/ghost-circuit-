/**
 * Main menu — minimal: title, one list of circuits (preview, record, your
 * best, RACE and BOARD), and a footer with leaderboards, help and status.
 */
import { formatCountdown } from '../game/util/date';
import type { Track } from '../game/track/TrackTypes';
import { TrackPreview } from '../splash/TrackPreview';
import { h, listen } from './dom';

export type MenuCircuit = {
  id: string;
  kind: 'daily' | 'alltime';
  name: string;
  tag: string;
  tagline: string;
  track: Track;
};

export type MenuStats = { record: string | null; mine: string | null; racers: number };

export type MenuCallbacks = {
  onRace: (circuitId: string) => void;
  /** Open the leaderboards, optionally on a specific circuit's board. */
  onBoards: (circuitId?: string) => void;
  onHelp: () => void;
  nextDailyAt: () => number;
};

type Row = { circuit: MenuCircuit; record: HTMLElement; mine: HTMLElement; racers: HTMLElement; preview: TrackPreview };

export class MainMenu {
  readonly root: HTMLElement;
  private readonly rows: Row[] = [];
  private readonly countdown: HTMLElement;
  private readonly player: HTMLElement;
  private readonly removers: Array<() => void> = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(parent: HTMLElement, circuits: MenuCircuit[], private readonly cb: MenuCallbacks) {
    const list = h('ol', { class: 'menu-list' });
    for (const c of circuits) {
      const canvas = h('canvas', { class: 'menu-preview', 'aria-hidden': 'true' });
      const record = h('span', { class: 'menu-stat-v', text: '—' });
      const mine = h('span', { class: 'menu-stat-v', text: '—' });
      const racers = h('span', { class: 'menu-stat-v', text: '0' });
      const race = h('button', { class: 'menu-btn primary', type: 'button', 'data-circuit': c.id, 'aria-label': `Race ${c.name}` }, 'Race');
      const board = h('button', { class: 'menu-btn', type: 'button', 'aria-label': `${c.name} leaderboard` }, 'Board');
      this.removers.push(
        listen(race, 'click', () => cb.onRace(c.id)),
        listen(board, 'click', () => cb.onBoards(c.id)),
      );
      list.append(
        h(
          'li',
          { class: `menu-row kind-${c.kind}` },
          canvas,
          h(
            'div',
            { class: 'menu-info' },
            h('span', { class: 'menu-tag', text: c.tag }),
            h('span', { class: 'menu-name', text: c.name }),
            h('span', { class: 'menu-line', text: c.tagline }),
            h(
              'span',
              { class: 'menu-stats' },
              h('span', {}, h('b', { text: '#1 ' }), record),
              h('span', {}, h('b', { text: 'You ' }), mine),
              h('span', {}, h('b', { text: 'Racers ' }), racers),
            ),
          ),
          h('div', { class: 'menu-actions' }, race, board),
        ),
      );
      this.rows.push({ circuit: c, record, mine, racers, preview: new TrackPreview(canvas, { topPad: 4, pad: 4 }) });
    }

    const boards = h('button', { class: 'menu-link', type: 'button', text: 'Leaderboards' });
    const help = h('button', { class: 'menu-link', type: 'button', text: 'How to play' });
    this.removers.push(
      listen(boards, 'click', () => cb.onBoards()),
      listen(help, 'click', () => cb.onHelp()),
    );
    this.countdown = h('span', { class: 'menu-foot-v', text: '--:--:--' });
    this.player = h('span', { class: 'menu-foot-v', text: '—' });

    this.root = h(
      'div',
      { class: 'menu hidden', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Ghost Circuit main menu' },
      h(
        'div',
        { class: 'menu-inner' },
        h(
          'header',
          { class: 'menu-head' },
          h('h1', { class: 'menu-title' }, h('span', { text: 'GHOST' }), h('span', { class: 'accent', text: 'CIRCUIT' })),
          h('p', { class: 'menu-sub', text: 'Daily 60-second time trials against real players’ ghosts.' }),
        ),
        list,
        h(
          'footer',
          { class: 'menu-foot' },
          h('div', { class: 'menu-links' }, boards, help),
          h(
            'div',
            { class: 'menu-status' },
            h('span', {}, 'New daily in ', this.countdown),
            h('span', {}, 'Racing as ', this.player),
          ),
        ),
      ),
    );
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  setPlayer(name: string): void {
    this.player.textContent = name;
  }

  setStats(circuitId: string, stats: MenuStats): void {
    const row = this.rows.find((r) => r.circuit.id === circuitId);
    if (!row) return;
    row.record.textContent = stats.record ?? '—';
    row.mine.textContent = stats.mine ?? '—';
    row.racers.textContent = String(stats.racers);
  }

  show(): void {
    this.root.classList.remove('hidden');
    for (const r of this.rows) r.preview.setTrack(r.circuit.track);
    const tick = (): void => {
      this.countdown.textContent = formatCountdown(this.cb.nextDailyAt() - Date.now());
    };
    tick();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(tick, 1000);
    requestAnimationFrame(() => {
      this.root.classList.add('in');
      this.root.querySelector<HTMLButtonElement>('.menu-btn.primary')?.focus({ preventScroll: true });
    });
  }

  hide(): void {
    this.root.classList.remove('in');
    this.root.classList.add('hidden');
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.hide();
    for (const r of this.removers.splice(0)) r();
    for (const r of this.rows) r.preview.dispose();
    this.root.remove();
  }
}
