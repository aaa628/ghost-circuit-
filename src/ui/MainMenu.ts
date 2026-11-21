/**
 * Main menu — a retro desktop: two OS dialog windows over a dithered,
 * halftone-printed backdrop with a single torn burgundy paper strip.
 *
 *   GHOST_CIRCUIT.EXE   pick a circuit (today's daily + two all-time boards),
 *                       each with a preview, record, your best, RACE and BOARD
 *   GHOST CHECK         leaderboards, how to play, next daily, who you are
 */
import { formatCountdown } from '../game/util/date';
import type { Track } from '../game/track/TrackTypes';
import { TrackPreview } from '../splash/TrackPreview';
import { h, listen } from './dom';
import { ditherTile, halftoneCar, pixelText, tornStrip } from './menuArt';

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

function titleBar(title: string, active: boolean): HTMLElement {
  return h(
    'div',
    { class: `win-title${active ? ' active' : ''}` },
    h('span', { class: 'win-glyph', 'aria-hidden': 'true' }),
    h('span', { class: 'win-name', text: title }),
    h('span', { class: 'win-box', 'aria-hidden': 'true' }),
  );
}

export class MainMenu {
  readonly root: HTMLElement;
  private readonly rows: Row[] = [];
  private readonly countdown: HTMLElement;
  private readonly player: HTMLElement;
  private readonly removers: Array<() => void> = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(parent: HTMLElement, circuits: MenuCircuit[], private readonly cb: MenuCallbacks) {
    // Backdrop: dither texture, giant pixel headline, torn strips, halftone car.
    const backdrop = h('div', { class: 'menu-bg', 'aria-hidden': 'true' });
    backdrop.style.backgroundImage = ditherTile('#151515', '#0f0f0f', 0.5, 2);
    const headline = h('div', { class: 'menu-headline', 'aria-hidden': 'true' });
    headline.append(pixelText('GHOST CIRCUIT', { px: 15, color: '#222222' }));
    const strip = h('div', { class: 'menu-strip', 'aria-hidden': 'true' });
    const edge = h('div', { class: 'strip-edge' });
    const fill = h('div', { class: 'strip-fill' });
    edge.style.clipPath = tornStrip(91, 9);
    fill.style.clipPath = tornStrip(33, 7);
    fill.style.backgroundImage = ditherTile('#5a0016', '#6d001a', 0.3, 3);
    strip.append(edge, fill);
    const car = halftoneCar(560, -0.62, 8);
    car.classList.add('menu-car');
    car.setAttribute('aria-hidden', 'true');

    // Main window: circuit select.
    const list = h('div', { class: 'circuit-list', role: 'list' });
    for (const c of circuits) {
      const canvas = h('canvas', { class: 'circuit-preview', 'aria-hidden': 'true' });
      const record = h('span', { class: 'stat-v', text: '—' });
      const mine = h('span', { class: 'stat-v', text: '—' });
      const racers = h('span', { class: 'stat-v', text: '0' });
      const race = h('button', { class: 'pix-btn primary', type: 'button', 'data-circuit': c.id, 'aria-label': `Race ${c.name}` }, 'RACE ▶');
      const board = h('button', { class: 'pix-btn', type: 'button', 'aria-label': `${c.name} leaderboard` }, 'BOARD');
      this.removers.push(
        listen(race, 'click', () => cb.onRace(c.id)),
        listen(board, 'click', () => cb.onBoards(c.id)),
      );
      const row = h(
        'div',
        { class: `circuit-row kind-${c.kind}`, role: 'listitem' },
        canvas,
        h(
          'div',
          { class: 'circuit-info' },
          h('span', { class: 'circuit-tag', text: c.tag }),
          h('span', { class: 'circuit-name', text: c.name }),
          h('span', { class: 'circuit-line', text: c.tagline }),
          h(
            'span',
            { class: 'circuit-stats' },
            h('span', { class: 'stat' }, h('b', { text: '#1 ' }), record),
            h('span', { class: 'stat' }, h('b', { text: 'YOU ' }), mine),
            h('span', { class: 'stat' }, h('b', { text: 'RACERS ' }), racers),
          ),
        ),
        h('div', { class: 'circuit-actions' }, race, board),
      );
      list.append(row);
      const preview = new TrackPreview(canvas, { topPad: 4, pad: 4 });
      this.rows.push({ circuit: c, record, mine, racers, preview });
    }
    const mainWin = h(
      'section',
      { class: 'win win-main', 'aria-label': 'Select a circuit' },
      titleBar('GHOST_CIRCUIT.EXE', true),
      h(
        'div',
        { class: 'win-body' },
        h('div', { class: 'win-heading' }, pixelText('SELECT CIRCUIT', { px: 10, color: '#0a0a0a' })),
        list,
      ),
    );

    // Side window: ghost check + leaderboards, help and status.
    const boards = h('button', { class: 'pix-btn primary wide', type: 'button', text: 'LEADERBOARDS' });
    const help = h('button', { class: 'pix-btn wide', type: 'button', text: 'HOW TO PLAY' });
    this.removers.push(
      listen(boards, 'click', () => cb.onBoards()),
      listen(help, 'click', () => cb.onHelp()),
    );
    this.countdown = h('span', { class: 'status-v', text: '--:--:--' });
    this.player = h('span', { class: 'status-v', text: '—' });
    const sideWin = h(
      'section',
      { class: 'win win-side', 'aria-label': 'Ghost check' },
      titleBar('GHOST CHECK', false),
      h(
        'div',
        { class: 'win-body' },
        h('div', { class: 'alert-row' }, h('span', { class: 'alert-icon', 'aria-hidden': 'true', text: 'i' }), h('p', { class: 'alert-text', text: 'ARE YOU SURE YOU CAN BEAT YOUR OWN GHOST?' })),
        h('div', { class: 'side-btns' }, boards, help),
        h('div', { class: 'status-line' }, h('span', { text: 'NEW DAILY IN' }), this.countdown),
        h('div', { class: 'status-line' }, h('span', { text: 'RACING AS' }), this.player),
      ),
    );

    this.root = h(
      'div',
      { class: 'menu hidden', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Ghost Circuit main menu' },
      backdrop,
      headline,
      strip,
      car,
      h('div', { class: 'menu-windows' }, mainWin, sideWin),
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
      this.root.querySelector<HTMLButtonElement>('.circuit-row .pix-btn')?.focus({ preventScroll: true });
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
