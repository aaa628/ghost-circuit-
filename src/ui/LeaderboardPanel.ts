/**
 * Leaderboard list (shared by the post-run modal and the slide-in panel) and
 * the panel itself: Today / Yesterday tabs, top 10 with "Race ghost" buttons,
 * a pinned row for the player, challenge-code entry and (locally) nickname.
 */
import { formatDateLabel } from '../game/util/date';
import { formatTime, type LeaderboardEntry, type LeaderboardResponse } from '../shared/api';
import { clear, h, icon, listen } from './dom';

export type RaceGhostHandler = (entry: LeaderboardEntry, date: string) => void;

/** "u/" on Reddit; nothing for local nicknames. */
let namePrefix = 'u/';
export function setNamePrefix(prefix: string): void {
  namePrefix = prefix;
}

export function displayUser(name: string): string {
  return `${namePrefix}${name}`;
}

export type ListHandlers = {
  onRace?: RaceGhostHandler;
  /** Share & Challenge from the player's own row. */
  onShareMine?: RaceGhostHandler;
};

export function renderLeaderboardList(
  container: HTMLElement,
  lb: LeaderboardResponse | null,
  me: string | null,
  handlers: ListHandlers | null,
  opts: { loading?: boolean; emptyText?: string } = {},
): void {
  const onRace = handlers?.onRace ?? null;
  const onShareMine = handlers?.onShareMine ?? null;
  clear(container);
  if (!lb) {
    container.append(h('div', { class: 'lb-empty', text: opts.loading ? 'Loading leaderboard…' : 'Leaderboard unavailable' }));
    return;
  }
  if (lb.entries.length === 0) {
    container.append(h('div', { class: 'lb-empty', text: opts.emptyText ?? 'No times yet — set the first record!' }));
    return;
  }
  const list = h('ol', { class: 'lb-list' });
  const row = (e: LeaderboardEntry, pinned: boolean): HTMLLIElement => {
    const isMe = !!me && e.username === me;
    const raceBtn =
      onRace && e.runId && !isMe
        ? h('button', { class: 'lb-race', type: 'button', title: `Race ${e.username}'s ghost`, 'aria-label': `Race ${e.username}'s ghost` }, icon('ghost', 16), 'Race')
        : null;
    if (raceBtn && onRace) raceBtn.addEventListener('click', () => onRace(e, lb.date));
    const shareBtn =
      onShareMine && e.runId && isMe
        ? h('button', { class: 'lb-race lb-share', type: 'button', title: 'Share & challenge', 'aria-label': 'Share and challenge' }, icon('share', 16), 'Share')
        : null;
    if (shareBtn && onShareMine) shareBtn.addEventListener('click', () => onShareMine(e, lb.date));
    const medal = e.rank <= 3 ? ` medal-${e.rank}` : '';
    return h(
      'li',
      { class: `lb-row${isMe ? ' me' : ''}${pinned ? ' pinned' : ''}${medal}` },
      h('span', { class: 'lb-rank', text: `#${e.rank}` }),
      h(
        'span',
        { class: 'lb-name' },
        h('span', { class: 'lb-user', text: e.bot ? e.username : `${namePrefix}${e.username}` }),
        e.bot ? h('span', { class: 'lb-bot', text: 'BOT' }) : null,
        isMe ? h('span', { class: 'lb-you', text: 'YOU' }) : null,
      ),
      h('span', { class: 'lb-time', text: formatTime(e.timeMs) }),
      raceBtn ?? shareBtn ?? h('span', { class: 'lb-race-spacer' }),
    );
  };
  for (const e of lb.entries) list.append(row(e, false));
  container.append(list);
  const mine = lb.me;
  if (mine && !lb.entries.some((e) => e.username === mine.username)) {
    const pin = h('ol', { class: 'lb-list lb-pinned', start: mine.rank });
    pin.append(row(mine, true));
    container.append(h('div', { class: 'lb-gap', text: '⋯' }), pin);
  }
  container.append(h('div', { class: 'lb-total', text: `${lb.total} racer${lb.total === 1 ? '' : 's'} on ${formatDateLabel(lb.date)}` }));
}

export type LeaderboardPanelCallbacks = {
  load: (date: string) => Promise<LeaderboardResponse>;
  onRace: RaceGhostHandler;
  onShareMine: RaceGhostHandler;
  onCode: (code: string) => void;
  onRename: ((name: string) => boolean) | null;
  onClose: () => void;
};

export class LeaderboardPanel {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly tabs: HTMLButtonElement[] = [];
  private readonly removers: Array<() => void> = [];
  private dates: [string, string] = ['', ''];
  private active = 0;
  private me: string | null = null;
  private loadToken = 0;
  private readonly nickInput: HTMLInputElement | null = null;

  constructor(parent: HTMLElement, private readonly cb: LeaderboardPanelCallbacks) {
    const closeBtn = h('button', { class: 'icon-btn panel-close', type: 'button', 'aria-label': 'Close leaderboard' }, icon('close'));
    this.removers.push(listen(closeBtn, 'click', () => cb.onClose()));
    const tabRow = h('div', { class: 'tabs', role: 'tablist' });
    ['Today', 'Yesterday'].forEach((label, i) => {
      const t = h('button', { class: 'tab', type: 'button', role: 'tab', text: label });
      this.removers.push(listen(t, 'click', () => this.select(i)));
      this.tabs.push(t);
      tabRow.append(t);
    });
    this.list = h('div', { class: 'lb-container' });

    const codeInput = h('input', {
      class: 'code-input',
      type: 'text',
      placeholder: 'GC-XXXXXXXX',
      maxlength: 20,
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': 'Challenge code',
    });
    const codeBtn = h('button', { class: 'btn btn-small', type: 'button', text: 'Race' });
    const submitCode = (): void => {
      const v = codeInput.value.trim();
      if (v) cb.onCode(v);
    };
    this.removers.push(
      listen(codeBtn, 'click', submitCode),
      listen(codeInput, 'keydown', (e) => {
        if (e.key === 'Enter') submitCode();
      }),
    );
    const codeRow = h('div', { class: 'panel-section' }, h('label', { class: 'panel-label', text: 'Got a challenge code from the comments?' }), h('div', { class: 'inline-form' }, codeInput, codeBtn));

    let nickRow: HTMLElement | null = null;
    if (cb.onRename) {
      const rename = cb.onRename;
      const nick = h('input', { class: 'code-input', type: 'text', maxlength: 20, autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Racer name' });
      const save = h('button', { class: 'btn btn-small', type: 'button', text: 'Save' });
      const doSave = (): void => {
        if (!rename(nick.value.trim())) nick.classList.add('invalid');
        else nick.classList.remove('invalid');
      };
      this.removers.push(
        listen(save, 'click', doSave),
        listen(nick, 'keydown', (e) => {
          if (e.key === 'Enter') doSave();
        }),
      );
      nickRow = h('div', { class: 'panel-section' }, h('label', { class: 'panel-label', text: 'Racer name (3–20 letters, numbers, _ or -)' }), h('div', { class: 'inline-form' }, nick, save));
      this.nickInput = nick;
    }

    this.root = h(
      'aside',
      { class: 'panel', 'aria-label': 'Leaderboard', 'aria-hidden': 'true' },
      h('header', { class: 'panel-head' }, h('h2', { text: 'Leaderboard' }), closeBtn),
      tabRow,
      this.list,
      codeRow,
      nickRow,
    );
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  open(today: string, yesterday: string, me: string | null): void {
    this.dates = [today, yesterday];
    this.me = me;
    if (this.nickInput && me) this.nickInput.value = me;
    this.root.classList.add('open');
    this.root.setAttribute('aria-hidden', 'false');
    this.select(this.active);
  }

  close(): void {
    this.root.classList.remove('open');
    this.root.setAttribute('aria-hidden', 'true');
  }

  refresh(): void {
    if (this.isOpen) this.select(this.active);
  }

  private select(i: number): void {
    this.active = i;
    this.tabs.forEach((t, k) => {
      t.classList.toggle('active', k === i);
      t.setAttribute('aria-selected', k === i ? 'true' : 'false');
    });
    const date = this.dates[i] ?? this.dates[0];
    const token = ++this.loadToken;
    renderLeaderboardList(this.list, null, this.me, null, { loading: true });
    this.cb
      .load(date)
      .then((lb) => {
        if (token === this.loadToken) {
          renderLeaderboardList(this.list, lb, this.me, { onRace: this.cb.onRace, onShareMine: this.cb.onShareMine });
        }
      })
      .catch(() => {
        if (token === this.loadToken) renderLeaderboardList(this.list, null, this.me, null);
      });
  }

  dispose(): void {
    for (const r of this.removers.splice(0)) r();
    this.root.remove();
  }
}
