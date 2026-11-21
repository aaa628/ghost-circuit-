/**
 * Main menu — a retro desktop "takeover": stacked OS dialog windows over a
 * dithered, halftone-printed backdrop torn by burgundy paper strips.
 *
 *   GHOST_CIRCUIT.EXE   pick a circuit (today's daily + two all-time boards),
 *                       each with a live preview, record and your best
 *   GHOST CHECK         "Are you sure you can beat your own ghost?" quick actions
 *   SYSTEM              next daily countdown and who you're racing as
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
  onBoards: () => void;
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
    backdrop.style.backgroundImage = ditherTile('#1c1c1c', '#0f0f0f', 0.5, 2);
    const headline = h('div', { class: 'menu-headline', 'aria-hidden': 'true' });
    headline.append(pixelText('GHOST', { px: 15, color: '#2e2e2e' }), pixelText('CIRCUIT!!!', { px: 15, color: '#2e2e2e' }));
    const strips = [0, 1].map((i) => {
      const strip = h('div', { class: `menu-strip strip-${i}`, 'aria-hidden': 'true' });
      const edge = h('div', { class: 'strip-edge' });
      const fill = h('div', { class: 'strip-fill' });
      edge.style.clipPath = tornStrip(91 + i * 17, 9);
      fill.style.clipPath = tornStrip(33 + i * 29, 7);
      fill.style.backgroundImage = ditherTile('#4a0012', '#6d001a', 0.38, 3);
      strip.append(edge, fill);
      return strip;
    });
    const car = halftoneCar(560, -0.62, 8);
    car.classList.add('menu-car');
    car.setAttribute('aria-hidden', 'true');

    // Decorative cascade of empty windows behind the main one.
    const stack = h('div', { class: 'menu-stack', 'aria-hidden': 'true' });
    for (let i = 0; i < 4; i++) {
      const w = h('div', { class: 'win win-ghost' }, titleBar('GHOST', false), h('div', { class: 'win-body' }));
      w.style.setProperty('--i', String(i));
      stack.append(w);
    }

    // Main window: circuit select.
    const list = h('div', { class: 'circuit-list', role: 'list' });
    for (const c of circuits) {
      const canvas = h('canvas', { class: 'circuit-preview', 'aria-hidden': 'true' });
      const record = h('span', { class: 'stat-v', text: '—' });
      const mine = h('span', { class: 'stat-v', text: '—' });
      const racers = h('span', { class: 'stat-v', text: '0' });
      const race = h('button', { class: 'pix-btn primary', type: 'button', 'data-circuit': c.id, 'aria-label': `Race ${c.name}` }, 'RACE ▶');
      this.removers.push(listen(race, 'click', () => cb.onRace(c.id)));
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
        race,
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

    // Alert window: the cheeky confirmation dialog.
    const yes = h('button', { class: 'pix-btn primary', type: 'button', text: 'YES' });
    const boards = h('button', { class: 'pix-btn', type: 'button', text: 'BOARDS' });
    const help = h('button', { class: 'pix-btn', type: 'button', text: '#HELP' });
    const daily = circuits.find((c) => c.kind === 'daily') ?? circuits[0];
    this.removers.push(
      listen(yes, 'click', () => daily && cb.onRace(daily.id)),
      listen(boards, 'click', () => cb.onBoards()),
      listen(help, 'click', () => cb.onHelp()),
    );
    const alertWin = h(
      'section',
      { class: 'win win-alert', role: 'dialog', 'aria-label': 'Ghost check' },
      titleBar('GHOST CHECK', false),
      h(
        'div',
        { class: 'win-body' },
        h('div', { class: 'alert-row' }, h('span', { class: 'alert-icon', 'aria-hidden': 'true', text: 'i' }), h('p', { class: 'alert-text', text: 'ARE YOU SURE YOU CAN BEAT YOUR OWN GHOST?' })),
        h('div', { class: 'alert-btns' }, yes, boards, help),
      ),
    );

    // Status window.
    this.countdown = h('span', { class: 'status-v', text: '--:--:--' });
    this.player = h('span', { class: 'status-v', text: '—' });
    const statusWin = h(
      'section',
      { class: 'win win-status', 'aria-label': 'Status' },
      titleBar('SYSTEM', false),
      h(
        'div',
        { class: 'win-body' },
        h('div', { class: 'status-line' }, h('span', { text: 'NEW DAILY IN' }), this.countdown),
        h('div', { class: 'status-line' }, h('span', { text: 'RACING AS' }), this.player),
        h('div', { class: 'status-line dim', text: 'ALL-TIME BOARDS NEVER RESET' }),
      ),
    );

    this.root = h(
      'div',
      { class: 'menu hidden', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Ghost Circuit main menu' },
      backdrop,
      headline,
      ...strips,
      car,
      h('div', { class: 'menu-windows' }, stack, mainWin, alertWin, statusWin),
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
