/**
 * Append-only event log, persisted to localStorage when available and to
 * memory otherwise (SSR, Lambda, private browsing, quota exceeded).
 * The in-memory copy is authoritative; persistence is best-effort.
 */
import { applyEvent, tick } from '../engine';
import { createInitialState } from '../seed';
import type { EngineEvent, EngineState } from '../types';

export const EVENT_LOG_STORAGE_KEY = 'lifeline.eventLog.v1';

/** The subset of the Web Storage API we use. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createMemoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

/** window.localStorage if running in a browser and writable, else an in-memory store. */
export function resolveStorage(): KeyValueStorage {
  try {
    // Only browsers: Node 25's experimental global localStorage warns on access.
    const ls = (globalThis as { window?: { localStorage?: KeyValueStorage } }).window?.localStorage;
    if (ls) {
      const probe = '__lifeline_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return ls;
    }
  } catch {
    // Access denied or quota exceeded.
  }
  return createMemoryStorage();
}

export interface EventLog {
  /** All events, oldest first. */
  all(): EngineEvent[];
  /** Events not yet acknowledged by the backend, oldest first. */
  pending(): EngineEvent[];
  /** Append events not already in the log (idempotent by id). */
  append(events: EngineEvent | readonly EngineEvent[]): void;
  /** Mirror an engine state's log (appends new events and picks up synced flags). */
  mirror(eventLog: readonly EngineEvent[]): void;
  markSynced(ids: Iterable<string>): void;
  clear(): void;
  /** True if the last write reached durable storage. */
  readonly persisted: boolean;
}

function isEventArray(value: unknown): value is EngineEvent[] {
  return (
    Array.isArray(value) &&
    value.every((e) => typeof e === 'object' && e !== null && typeof e.id === 'string' && typeof e.type === 'string')
  );
}

export function createEventLog(
  options: { storage?: KeyValueStorage; key?: string } = {},
): EventLog {
  const storage = options.storage ?? resolveStorage();
  const key = options.key ?? EVENT_LOG_STORAGE_KEY;
  let persisted = true;

  let events: EngineEvent[] = [];
  try {
    const raw = storage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    events = isEventArray(parsed) ? parsed : [];
  } catch {
    events = [];
  }
  const ids = new Set(events.map((e) => e.id));

  const save = () => {
    try {
      storage.setItem(key, JSON.stringify(events));
      persisted = true;
    } catch {
      persisted = false;
    }
  };

  return {
    all: () => [...events],
    pending: () => events.filter((e) => !e.synced),
    append(input) {
      const list = Array.isArray(input) ? input : [input as EngineEvent];
      let changed = false;
      for (const e of list) {
        if (ids.has(e.id)) continue;
        ids.add(e.id);
        events.push({ ...e });
        changed = true;
      }
      if (changed) save();
    },
    mirror(eventLog) {
      const synced = new Set(eventLog.filter((e) => e.synced).map((e) => e.id));
      let changed = false;
      events = events.map((e) => {
        if (!e.synced && synced.has(e.id)) {
          changed = true;
          return { ...e, synced: true };
        }
        return e;
      });
      for (const e of eventLog) {
        if (ids.has(e.id)) continue;
        ids.add(e.id);
        events.push({ ...e });
        changed = true;
      }
      if (changed) save();
    },
    markSynced(input) {
      const target = new Set(input);
      let changed = false;
      events = events.map((e) => {
        if (e.synced || !target.has(e.id)) return e;
        changed = true;
        return { ...e, synced: true };
      });
      if (changed) save();
    },
    clear() {
      events = [];
      ids.clear();
      try {
        storage.removeItem(key);
      } catch {
        // Ignore: memory copy is already cleared.
      }
    },
    get persisted() {
      return persisted;
    },
  };
}

/**
 * Rebuild engine state from a persisted log (e.g. after a page reload during
 * an outage): advance the sim clock to each event's time, then apply it.
 * Origin and synced flags are preserved from the log.
 */
export function replayEventLog(
  events: readonly EngineEvent[],
  options: { initial?: EngineState; untilSimTime?: number } = {},
): EngineState {
  let state = options.initial ?? createInitialState();
  for (const event of events) {
    if (event.simTime > state.simTime) state = tick(state, event.simTime - state.simTime);
    state = applyEvent(state, event);
  }
  if (options.untilSimTime !== undefined && options.untilSimTime > state.simTime) {
    state = tick(state, options.untilSimTime - state.simTime);
  }
  return state;
}
