/** localStorage wrapper that never throws (private mode, sandboxed iframes…). */

const memory = new Map<string, string>();

function backend(): Storage | null {
  try {
    const s = globalThis.localStorage;
    const probe = '__gc_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

const store = backend();

export function readString(key: string): string | null {
  try {
    return store ? store.getItem(key) : (memory.get(key) ?? null);
  } catch {
    return memory.get(key) ?? null;
  }
}

export function writeString(key: string, value: string): void {
  memory.set(key, value);
  try {
    store?.setItem(key, value);
  } catch {
    // Quota exceeded or blocked: keep the in-memory copy.
  }
}

export function removeKey(key: string): void {
  memory.delete(key);
  try {
    store?.removeItem(key);
  } catch {
    // ignore
  }
}

export function readJson<T>(key: string, guard: (v: unknown) => v is T): T | null {
  const raw = readString(key);
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return guard(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  writeString(key, JSON.stringify(value));
}

/** Remove keys with a prefix whose date suffix is older than `keepDates`. */
export function pruneByDate(prefix: string, keepDates: readonly string[]): void {
  if (!store) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      if (!keepDates.some((d) => k.endsWith(d))) doomed.push(k);
    }
    for (const k of doomed) store.removeItem(k);
  } catch {
    // ignore
  }
}
