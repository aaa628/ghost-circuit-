/**
 * Platform bridge. On Reddit the Devvit client APIs are used; in a plain
 * browser (local mode) the same calls fall back to web equivalents. The
 * Devvit client module is safe to import outside Reddit — its context is
 * simply undefined — so every call here is guarded by IS_DEVVIT.
 */
import {
  canRunAsUser,
  context,
  getShareData,
  navigateTo,
  requestExpandedMode,
  showLoginPrompt,
  showShareSheet,
} from '@devvit/web/client';
import { isDateKey } from '../game/util/date';
import { isRunId } from '../shared/api';
import { readString, removeKey, writeString } from './storage';

export const IS_DEVVIT: boolean =
  typeof (globalThis as { devvit?: unknown }).devvit === 'object' && (globalThis as { devvit?: unknown }).devvit !== null;

export type ChallengeRef = { date: string; runId: string };

/** Devvit context, or null outside Reddit. */
export function devvitContext(): typeof context | null {
  return IS_DEVVIT && context ? context : null;
}

export function postDateKey(): string | null {
  const v = devvitContext()?.postData?.dateKey;
  return isDateKey(v) ? v : null;
}

export function currentUsername(): string | null {
  return devvitContext()?.username ?? null;
}

const PENDING_KEY = 'gc:v1:pending-challenge';

/** Challenge passed in via a Reddit share link (Devvit share data). */
export function readShareChallenge(): ChallengeRef | null {
  if (!IS_DEVVIT) return null;
  try {
    const raw = getShareData();
    return raw ? parseChallengePayload(raw) : null;
  } catch {
    return null;
  }
}

export function encodeChallengePayload(ref: ChallengeRef): string {
  return JSON.stringify({ d: ref.date, c: ref.runId });
}

export function parseChallengePayload(raw: string): ChallengeRef | null {
  try {
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === 'object' && 'd' in v && 'c' in v && isDateKey(v.d) && isRunId(v.c)) {
      return { date: v.d, runId: v.c };
    }
  } catch {
    // ignore
  }
  return null;
}

/** Splash → game hand-off for a challenge (both entrypoints share storage). */
export function stashPendingChallenge(ref: ChallengeRef): void {
  writeString(PENDING_KEY, JSON.stringify({ ...ref, at: Date.now() }));
}

export function takePendingChallenge(): ChallengeRef | null {
  const raw = readString(PENDING_KEY);
  removeKey(PENDING_KEY);
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (
      v && typeof v === 'object' && 'date' in v && 'runId' in v && 'at' in v &&
      isDateKey(v.date) && isRunId(v.runId) && typeof v.at === 'number' && Date.now() - v.at < 5 * 60_000
    ) {
      return { date: v.date, runId: v.runId };
    }
  } catch {
    // ignore
  }
  return null;
}

/** Challenge from the page URL (?date=YYYY-MM-DD&challenge=<runId>). */
export function readUrlChallenge(): ChallengeRef | null {
  try {
    const params = new URLSearchParams(globalThis.location.search);
    const date = params.get('date');
    const runId = params.get('challenge');
    if (isDateKey(date) && isRunId(runId)) return { date, runId };
  } catch {
    // ignore
  }
  return null;
}

/** Shareable URL for the standalone build. */
export function challengeUrl(ref: ChallengeRef): string {
  const url = new URL(globalThis.location.href);
  url.pathname = url.pathname.replace(/[^/]*$/, '');
  url.search = '';
  url.hash = '';
  url.searchParams.set('date', ref.date);
  url.searchParams.set('challenge', ref.runId);
  return url.toString();
}

/** Open the native Reddit share sheet with the challenge attached. */
export async function shareChallenge(ref: ChallengeRef, title: string, text: string): Promise<boolean> {
  if (!IS_DEVVIT) return false;
  try {
    await showShareSheet({ title, text, data: encodeChallengePayload(ref) });
    return true;
  } catch (err) {
    console.warn('[platform] share sheet failed', err);
    return false;
  }
}

/** Ask Reddit for permission to act as the user (needed to comment). */
export async function ensureRunAsUser(event: Event): Promise<boolean> {
  if (!IS_DEVVIT) return false;
  try {
    return await canRunAsUser(event);
  } catch {
    return false;
  }
}

export function promptLogin(): void {
  if (IS_DEVVIT) {
    try {
      showLoginPrompt();
    } catch {
      // ignore
    }
  }
}

export function openUrl(url: string): void {
  if (IS_DEVVIT) {
    navigateTo(url);
  } else {
    globalThis.location.href = url;
  }
}

export function openPost(postId: string): void {
  const ctx = devvitContext();
  const id = postId.replace(/^t3_/, '');
  const sub = ctx?.subredditName;
  openUrl(sub ? `https://www.reddit.com/r/${sub}/comments/${id}/` : `https://www.reddit.com/comments/${id}/`);
}

/** Splash "RACE" button: open the expanded game (or navigate locally). */
export function launchGame(event: MouseEvent, query = ''): void {
  if (IS_DEVVIT) {
    requestExpandedMode(event, 'game');
  } else {
    globalThis.location.href = `./game.html${query}`;
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
