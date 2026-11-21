/**
 * On-screen controls for phones/tablets: steer left/right on the left thumb,
 * gas / brake / drift on the right. Multi-touch via Pointer Events with
 * pointer capture; every listener is removed in dispose().
 */
import type { InputController, TouchState } from '../game/input/InputController';
import { h, isTouchDevice } from './dom';

type Control = keyof TouchState;

export class TouchControls {
  readonly root: HTMLElement;
  private readonly removers: Array<() => void> = [];

  constructor(parent: HTMLElement, private readonly input: InputController) {
    const btn = (control: Control, label: string, cls: string): HTMLButtonElement => {
      const b = h('button', { class: `tc-btn ${cls}`, type: 'button', 'aria-label': label, 'data-control': control }, label);
      this.bind(b, control);
      return b;
    };
    this.root = h(
      'div',
      { class: 'touch-controls' },
      h('div', { class: 'tc-left' }, btn('left', '◀', 'tc-steer'), btn('right', '▶', 'tc-steer')),
      h('div', { class: 'tc-right' }, h('div', { class: 'tc-col' }, btn('drift', 'DRIFT', 'tc-small'), btn('brake', 'BRAKE', 'tc-small')), btn('gas', 'GAS', 'tc-gas')),
    );
    parent.append(this.root);
    this.setVisible(isTouchDevice());
    const onFirstTouch = (): void => this.setVisible(true);
    window.addEventListener('touchstart', onFirstTouch, { once: true, passive: true });
    this.removers.push(() => window.removeEventListener('touchstart', onFirstTouch));
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('visible', v);
    document.body.classList.toggle('has-touch', v);
  }

  private bind(el: HTMLElement, control: Control): void {
    const pointers = new Set<number>();
    const update = (): void => {
      const down = pointers.size > 0;
      this.input.touch[control] = down;
      el.classList.toggle('down', down);
    };
    const onDown = (e: PointerEvent): void => {
      e.preventDefault();
      pointers.add(e.pointerId);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      update();
      this.input.touchPressed(control);
    };
    const onUp = (e: PointerEvent): void => {
      pointers.delete(e.pointerId);
      update();
    };
    const noMenu = (e: Event): void => e.preventDefault();
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('lostpointercapture', onUp);
    el.addEventListener('contextmenu', noMenu);
    this.removers.push(() => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('lostpointercapture', onUp);
      el.removeEventListener('contextmenu', noMenu);
      pointers.clear();
      this.input.touch[control] = false;
    });
  }

  dispose(): void {
    for (const r of this.removers.splice(0)) r();
    this.root.remove();
  }
}
