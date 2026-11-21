/**
 * Share & Challenge modal. Shows the ready-to-paste snippet, and offers:
 *   • Copy (snippet + link locally / snippet + challenge code on Reddit)
 *   • Share… (Reddit native share sheet — the link carries the challenge)
 *   • Post as comment (on the daily post, as the user)
 */
import { h, icon, listen } from './dom';

export type ShareView = {
  snippet: string;
  code: string;
  link: string | null;
  canShareSheet: boolean;
  canComment: boolean;
};

export type ShareCallbacks = {
  onCopy: (text: string) => void;
  onShareSheet: (event: MouseEvent) => void;
  onComment: (event: MouseEvent) => void;
  onClose: () => void;
};

export class ShareModal {
  readonly root: HTMLElement;
  private readonly text: HTMLTextAreaElement;
  private readonly codeEl: HTMLElement;
  private readonly sheetBtn: HTMLButtonElement;
  private readonly commentBtn: HTMLButtonElement;
  private readonly removers: Array<() => void> = [];

  constructor(parent: HTMLElement, cb: ShareCallbacks) {
    this.text = h('textarea', { class: 'share-text', rows: 3, readonly: true, 'aria-label': 'Share text' });
    this.codeEl = h('code', { class: 'share-code' });
    const copyBtn = h('button', { class: 'btn btn-primary', type: 'button' }, icon('copy', 18), 'Copy');
    this.sheetBtn = h('button', { class: 'btn btn-share', type: 'button' }, icon('share', 18), 'Share…');
    this.commentBtn = h('button', { class: 'btn', type: 'button' }, icon('comment', 18), 'Post as comment');
    const closeBtn = h('button', { class: 'icon-btn pr-close', type: 'button', 'aria-label': 'Close share' }, icon('close'));
    this.removers.push(
      listen(copyBtn, 'click', () => cb.onCopy(this.text.value)),
      listen(this.sheetBtn, 'click', (e) => cb.onShareSheet(e)),
      listen(this.commentBtn, 'click', (e) => cb.onComment(e)),
      listen(closeBtn, 'click', () => cb.onClose()),
      listen(this.text, 'focus', () => this.text.select()),
    );
    const card = h(
      'div',
      { class: 'share-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Share and challenge' },
      closeBtn,
      h('h2', { text: 'Share & Challenge' }),
      h('p', { class: 'share-lede', text: 'Drop this in the comments — anyone who opens it races your ghost head-to-head.' }),
      this.text,
      h('div', { class: 'share-code-row' }, h('span', { text: 'Challenge code' }), this.codeEl),
      h('div', { class: 'pr-actions' }, copyBtn, this.sheetBtn, this.commentBtn),
    );
    this.root = h('div', { class: 'modal-backdrop share hidden' }, card);
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(v: ShareView): void {
    this.text.value = v.snippet;
    this.codeEl.textContent = v.code;
    this.sheetBtn.hidden = !v.canShareSheet;
    this.commentBtn.hidden = !v.canComment;
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
