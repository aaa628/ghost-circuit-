/**
 * Keyboard + touch input merged into one CarInput. Owns its DOM listeners and
 * removes every one of them in dispose(), so restarts never double-bind keys.
 * Keys typed into text fields are ignored.
 */
import type { CarInput } from '../physics/CarController';

export type TouchState = { gas: boolean; brake: boolean; left: boolean; right: boolean; drift: boolean };

const KEY_MAP: Record<string, keyof TouchState> = {
  ArrowUp: 'gas',
  KeyW: 'gas',
  ArrowDown: 'brake',
  KeyS: 'brake',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Space: 'drift',
  ShiftLeft: 'drift',
  ShiftRight: 'drift',
};

export type InputCallbacks = {
  onRestart: () => void;
  onEscape: () => void;
  /** First movement input (used for instant start + audio unlock). */
  onAnyMovement: () => void;
};

const isTyping = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
};

export class InputController {
  private readonly keys: TouchState = { gas: false, brake: false, left: false, right: false, drift: false };
  readonly touch: TouchState = { gas: false, brake: false, left: false, right: false, drift: false };
  private readonly out: CarInput = { throttle: 0, brake: 0, steer: 0, drift: false };
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;
  private readonly onBlur: () => void;
  /** When false, inputs read as neutral (e.g. while a modal is open). */
  enabled = true;

  constructor(private readonly callbacks: InputCallbacks) {
    this.onKeyDown = (e) => {
      if (isTyping(e.target)) return;
      if (e.code === 'KeyR' && !e.repeat && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        this.callbacks.onRestart();
        return;
      }
      if (e.code === 'Escape') {
        this.callbacks.onEscape();
        return;
      }
      const k = KEY_MAP[e.code];
      if (!k) return;
      e.preventDefault();
      this.keys[k] = true;
      if (this.enabled && k !== 'drift') this.callbacks.onAnyMovement();
    };
    this.onKeyUp = (e) => {
      const k = KEY_MAP[e.code];
      if (k) this.keys[k] = false;
    };
    this.onBlur = () => this.releaseAll();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  /** Called by the touch UI when a control is pressed. */
  touchPressed(control: keyof TouchState): void {
    if (this.enabled && control !== 'drift') this.callbacks.onAnyMovement();
  }

  releaseAll(): void {
    for (const k of Object.keys(this.keys) as Array<keyof TouchState>) {
      this.keys[k] = false;
      this.touch[k] = false;
    }
  }

  /** True while any movement control is held. */
  get anyHeld(): boolean {
    const k = this.keys;
    const t = this.touch;
    return k.gas || k.brake || k.left || k.right || t.gas || t.brake || t.left || t.right;
  }

  read(): CarInput {
    const o = this.out;
    if (!this.enabled) {
      o.throttle = 0;
      o.brake = 0;
      o.steer = 0;
      o.drift = false;
      return o;
    }
    const k = this.keys;
    const t = this.touch;
    o.throttle = k.gas || t.gas ? 1 : 0;
    o.brake = k.brake || t.brake ? 1 : 0;
    o.steer = (k.right || t.right ? 1 : 0) - (k.left || t.left ? 1 : 0);
    o.drift = k.drift || t.drift;
    return o;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.releaseAll();
  }
}
