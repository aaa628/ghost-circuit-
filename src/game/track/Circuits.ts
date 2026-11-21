/**
 * Circuit registry.
 *
 * A circuit key identifies a track and its leaderboard:
 *   • "YYYY-MM-DD"  — the daily circuit for that UTC date (new every day,
 *                     ranked only on its day)
 *   • "perm-*"      — a permanent circuit with an all-time leaderboard
 *                     (always open, never expires)
 * Wire types keep the historical field name `dateKey`; its value is a circuit key.
 */
import { formatDateLabel, isDateKey } from '../util/date';
import type { ArchetypeId } from './TrackTypes';

export type PermanentCircuit = {
  id: string;
  name: string;
  /** Short label for tabs. */
  short: string;
  tagline: string;
  archetype: ArchetypeId;
  /** Generator seed string (changing it changes the track forever). */
  seed: string;
};

export const PERMANENT_CIRCUITS: readonly PermanentCircuit[] = [
  {
    id: 'perm-ridge',
    name: 'GLITCH RIDGE',
    short: 'RIDGE',
    tagline: 'Hairpins stacked on hairpins. Brake late, drift early.',
    archetype: 'hairpin',
    seed: 'ghost-circuit:permanent:glitch-ridge:v1',
  },
  {
    id: 'perm-vault',
    name: 'STATIC VAULT',
    short: 'VAULT',
    tagline: 'Long fast sweepers. Pure line, pure nerve.',
    archetype: 'speedway',
    seed: 'ghost-circuit:permanent:static-vault:v1',
  },
  {
    id: 'perm-drift',
    name: 'SIDEWAYS',
    short: 'DRIFT',
    tagline: 'No hazards, no boosts. Just corners. Keep it sideways.',
    archetype: 'drift',
    seed: 'ghost-circuit:permanent:sideways:v1',
  },
];

export function permanentCircuit(id: string): PermanentCircuit | undefined {
  return PERMANENT_CIRCUITS.find((c) => c.id === id);
}

export function isPermanent(id: string): boolean {
  return permanentCircuit(id) !== undefined;
}

export function isCircuitKey(value: unknown): value is string {
  return isDateKey(value) || (typeof value === 'string' && isPermanent(value));
}

/** "NOV 21 · #11" for dailies, "ALL-TIME" for permanent circuits. */
export function circuitBadge(id: string, circuitNo: number): string {
  return isPermanent(id) ? 'ALL-TIME CIRCUIT' : `${formatDateLabel(id)} · #${circuitNo}`;
}

/** Short board label: "NOV 21" or "GLITCH RIDGE". */
export function boardLabel(id: string): string {
  return permanentCircuit(id)?.name ?? formatDateLabel(id);
}
