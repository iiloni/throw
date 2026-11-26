import { useCallback, useSyncExternalStore } from 'react';
import type { z } from 'zod';

const listeners = new Set<() => void>();

// Devices that deny storage or exhaust their quota keep preferences for this session.
const sessionPreferences = new Map<string, string>();

function preferenceSnapshot(key: string) {
  const session = sessionPreferences.get(key);
  if (session !== undefined) return session;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

export { subscribe as watchPreferences };

/** Reads a stored preference outside React; a missing or invalid value gives the fallback. */
export function readPreference<T extends z.ZodType>(
  key: string,
  schema: T,
  fallback: z.infer<T>,
): z.infer<T> {
  try {
    const raw = preferenceSnapshot(key);
    if (raw === null) return fallback;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

/** Stores a preference and tells every reader in this tab. */
export function writePreference(key: string, value: unknown) {
  const raw = JSON.stringify(value);
  try {
    localStorage.setItem(key, raw);
    sessionPreferences.delete(key);
  } catch {
    sessionPreferences.set(key, raw);
  }
  for (const listener of listeners) listener();
}

/**
 * A UI preference persisted in localStorage and shared by every component that
 * reads the same key. Stored values that fail the schema fall back to the default.
 */
export function usePersistentState<T extends z.ZodType>(
  key: string,
  schema: T,
  fallback: z.infer<T>,
): [z.infer<T>, (value: z.infer<T>) => void] {
  const raw = useSyncExternalStore(subscribe, () => preferenceSnapshot(key));

  let value: z.infer<T> = fallback;
  if (raw !== null) {
    try {
      const parsed = schema.safeParse(JSON.parse(raw));
      if (parsed.success) value = parsed.data;
    } catch {
      // Unparseable values fall back to the default.
    }
  }

  const setValue = useCallback((next: z.infer<T>) => writePreference(key, next), [key]);

  return [value, setValue];
}
