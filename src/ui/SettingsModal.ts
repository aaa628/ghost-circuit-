import type { StartMode } from '../game/scenes/RaceScene';
import { h, icon, listen } from './dom';

export type Settings = { startMode: StartMode };

export type SettingsCallbacks = {
  onChange: (s: Settings) => void;
  onClose: () => void;
};

/** Small settings sheet: start mode (instant vs 3-2-1) and how-to-play. */
export class SettingsModal {
  readonly root: HTMLElement;
  private readonly instant: HTMLInputElement;
  private readonly countdown: HTMLInputElement;
  private readonly removers: Array<() => void> = [];
  private current: Settings = { startMode: 'instant' };

  constructor(parent: HTMLElement, cb: SettingsCallbacks) {
    this.instant = h('input', { type: 'radio', name: 'gc-start', value: 'instant' });
    this.countdown = h('input', { type: 'radio', name: 'gc-start', value: 'countdown' });
    const emit = (): void => {
      this.current = { ...this.current, startMode: this.countdown.checked ? 'countdown' : 'instant' };
      cb.onChange(this.current);
    };
    const closeBtn = h('button', { class: 'icon-btn pr-close', type: 'button', 'aria-label': 'Close settings' }, icon('close'));
    this.removers.push(
      listen(this.instant, 'change', emit),
      listen(this.countdown, 'change', emit),
      listen(closeBtn, 'click', () => cb.onClose()),
    );
    const card = h(
      'div',
      { class: 'share-card settings-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Settings' },
      closeBtn,
      h('h2', { text: 'How to play' }),
      h(
        'ul',
        { class: 'howto' },
        h('li', { text: 'One new circuit every day at 00:00 UTC — everyone races the same one.' }),
        h('li', { text: 'Clear every checkpoint in order, then cross the finish line within 60 seconds.' }),
        h('li', { text: 'Race translucent ghosts of real players: your PB, today’s #1, yesterday’s champ, or a challenger.' }),
        h('li', { text: 'Burgundy boost pads launch you; burgundy-and-white hazards move to the race clock — learn their rhythm.' }),
        h('li', { text: 'Split lanes: the inner lane is shorter but tighter. Drift (Space / DRIFT) for hairpins.' }),
        h('li', { text: 'R restarts instantly. Share your run to challenge friends in the comments.' }),
      ),
      h('h2', { text: 'Start' }),
      h(
        'div',
        { class: 'radio-row' },
        h('label', {}, this.instant, ' Instant (on first input)'),
        h('label', {}, this.countdown, ' 3-2-1-GO countdown'),
      ),
    );
    this.root = h('div', { class: 'modal-backdrop settings hidden' }, card);
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(s: Settings): void {
    this.current = s;
    this.instant.checked = s.startMode === 'instant';
    this.countdown.checked = s.startMode === 'countdown';
    this.root.classList.remove('hidden');
    requestAnimationFrame(() => this.root.classList.add('in'));
  }

  hide(): void {
    this.root.classList.remove('in');
    this.root.classList.add('hidden');
  }

  dispose(): void {
    for (const r of this.removers.splice(0)) r();
    this.root.remove();
  }
}
