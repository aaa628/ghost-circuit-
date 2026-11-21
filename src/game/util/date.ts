import { LAUNCH_DATE_KEY } from '../config';

const DAY_MS = 86_400_000;
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

/** UTC date key YYYY-MM-DD for a timestamp. */
export function utcDateKey(ms: number = Date.now()): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Parse a date key to the UTC midnight timestamp, or NaN when invalid. */
export function dateKeyToMs(key: string): number {
  const m = DATE_KEY_RE.exec(key);
  if (!m) return Number.NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return Number.NaN;
  }
  return ms;
}

export function isDateKey(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(dateKeyToMs(value));
}

/** Shift a date key by whole days. */
export function shiftDateKey(key: string, days: number): string {
  const ms = dateKeyToMs(key);
  if (Number.isNaN(ms)) throw new Error(`Invalid date key: ${key}`);
  return utcDateKey(ms + days * DAY_MS);
}

/** Milliseconds until the next UTC midnight. */
export function msUntilNextUtcDay(now: number = Date.now()): number {
  const next = Math.floor(now / DAY_MS) * DAY_MS + DAY_MS;
  return next - now;
}

/** Circuit number (#1 = launch day). */
export function circuitNumber(key: string): number {
  const ms = dateKeyToMs(key);
  const launch = dateKeyToMs(LAUNCH_DATE_KEY);
  if (Number.isNaN(ms) || Number.isNaN(launch)) return 1;
  return Math.max(1, Math.round((ms - launch) / DAY_MS) + 1);
}

/** Whole days since 1970-01-01 for a date key. */
export function dayIndex(key: string): number {
  const ms = dateKeyToMs(key);
  return Number.isNaN(ms) ? 0 : Math.round(ms / DAY_MS);
}

/** "NOV 21" style label. */
export function formatDateLabel(key: string): string {
  const m = DATE_KEY_RE.exec(key);
  if (!m) return key;
  const month = MONTHS[Number(m[2]) - 1] ?? '';
  return `${month} ${Number(m[3])}`;
}

/** "05:12:33" countdown text. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}
