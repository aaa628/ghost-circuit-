import { h } from './dom';

/** Lightweight transient notifications (works the same on Reddit and locally). */
export class Toaster {
  private readonly root: HTMLElement;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(parent: HTMLElement) {
    this.root = h('div', { class: 'toasts', 'aria-live': 'polite' });
    parent.append(this.root);
  }

  show(message: string, kind: 'info' | 'good' | 'bad' = 'info', ms = 2600): void {
    const el = h('div', { class: `toast toast-${kind}`, text: message });
    this.root.append(el);
    requestAnimationFrame(() => el.classList.add('in'));
    const t1 = setTimeout(() => {
      el.classList.remove('in');
      const t2 = setTimeout(() => {
        el.remove();
        this.timers.delete(t2);
      }, 260);
      this.timers.add(t2);
      this.timers.delete(t1);
    }, ms);
    this.timers.add(t1);
  }

  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.root.remove();
  }
}
