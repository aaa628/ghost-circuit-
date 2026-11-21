/**
 * Tiny DOM helpers. User-provided strings (usernames, codes) are only ever
 * assigned via textContent — never innerHTML — so they can't inject markup.
 */

type Attrs = Record<string, string | number | boolean | undefined>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Set text only when it changed (avoids layout work in the frame loop). */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function toggleClass(el: Element, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICONS = {
  soundOn: 'M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zm-2.5-8.8v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z',
  soundOff: 'M4 9v6h4l5 4V5L8 9H4zm12.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z',
  trophy: 'M7 3h10v2h3v3a5 5 0 0 1-4.2 4.9A5 5 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1a5 5 0 0 1-2.8-3A5 5 0 0 1 4 8V5h3V3zm0 4H6v1a3 3 0 0 0 1.4 2.5A6 6 0 0 1 7 8V7zm10 0v1c0 .9-.1 1.7-.4 2.5A3 3 0 0 0 18 8V7h-1z',
  restart: 'M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z',
  share: 'M18 16a3 3 0 0 0-2.4 1.2L8.9 13.7a3 3 0 0 0 0-1.4l6.7-3.5A3 3 0 1 0 15 7l-6.7 3.5a3 3 0 1 0 0 3l6.7 3.5A3 3 0 1 0 18 16z',
  close: 'M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z',
  gear: 'M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
  ghost: 'M12 2a8 8 0 0 0-8 8v12l3-2 2.5 2 2.5-2 2.5 2 2.5-2 3 2V10a8 8 0 0 0-8-8zm-3 10a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm6 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
  flag: 'M5 3h2v18H5V3zm3 1h11l-2 4 2 4H8V4z',
  copy: 'M8 3h11v13h-2V5H8V3zM5 7h10v14H5V7z',
  comment: 'M4 4h16v12H8l-4 4V4z',
  menu: 'M3 5h18v3H3V5zm0 5.5h18v3H3v-3zM3 16h18v3H3v-3z',
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 20): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name]);
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}

/** Add a listener and return its remover. */
export function listen<K extends keyof HTMLElementEventMap>(
  el: HTMLElement | Window | Document,
  type: K,
  fn: (e: HTMLElementEventMap[K]) => void,
  opts?: AddEventListenerOptions,
): () => void {
  el.addEventListener(type, fn as EventListener, opts);
  return () => el.removeEventListener(type, fn as EventListener, opts);
}

export const isTouchDevice = (): boolean =>
  typeof window !== 'undefined' &&
  (('ontouchstart' in window && navigator.maxTouchPoints > 0) || window.matchMedia('(pointer: coarse)').matches);
