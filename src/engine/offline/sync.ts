/**
 * Sends events recorded in edge mode to the backend once the connection is back.
 * The transport is injected: Engineer 2 supplies the real POST /events call.
 *
 * Guarantees:
 *  - in order: events are sent one at a time, oldest first; a failure stops the run
 *    so later events never overtake earlier ones.
 *  - idempotent by event id: an id that was acknowledged is never sent again, and
 *    the backend should also upsert by id.
 */
import type { EngineEvent } from '../types';

export type SendEventFn = (event: EngineEvent) => Promise<void>;

export const MOCK_SEND_DELAY_MS = 800;

/** Default transport for demos: resolves after 800 ms. */
export function createMockSend(delayMs = MOCK_SEND_DELAY_MS): SendEventFn {
  return () => new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

export type SyncStatus = 'idle' | 'syncing' | 'complete' | 'error';

export interface SyncProgress {
  status: SyncStatus;
  total: number;
  sent: number;
  currentEventId?: string;
  error?: string;
  /** Ready-to-display text, e.g. "Synchronizing 7 offline events… (3/7)". */
  message: string;
}

export interface SyncResult {
  syncedIds: string[];
  failed?: { eventId: string; error: string };
  /** Events skipped because they were already acknowledged. */
  skipped: number;
}

export interface SyncOptions {
  send?: SendEventFn;
  onProgress?: (progress: SyncProgress) => void;
  /** Ids already acknowledged by the backend; updated in place as events succeed. */
  acknowledged?: Set<string>;
}

const plural = (n: number) => `${n} offline event${n === 1 ? '' : 's'}`;

/**
 * Send every unsynced event in order. Pass `state.eventLog` (or `eventLog.pending()`);
 * already-synced and duplicate events are filtered out.
 */
export async function syncPendingEvents(
  events: readonly EngineEvent[],
  options: SyncOptions = {},
): Promise<SyncResult> {
  const send = options.send ?? createMockSend();
  const acknowledged = options.acknowledged ?? new Set<string>();
  const report = options.onProgress ?? (() => {});

  const seen = new Set<string>();
  let skipped = 0;
  const queue: EngineEvent[] = [];
  for (const e of events) {
    if (e.synced || seen.has(e.id)) continue;
    seen.add(e.id);
    if (acknowledged.has(e.id)) {
      skipped++;
      continue;
    }
    queue.push(e);
  }

  const total = queue.length;
  const syncedIds: string[] = [];
  if (total === 0) {
    report({ status: 'complete', total, sent: 0, message: '✓ Everything is synchronized' });
    return { syncedIds, skipped };
  }

  report({ status: 'syncing', total, sent: 0, message: `Synchronizing ${plural(total)}…` });
  for (const event of queue) {
    report({
      status: 'syncing',
      total,
      sent: syncedIds.length,
      currentEventId: event.id,
      message: `Synchronizing ${plural(total)}… (${syncedIds.length + 1}/${total})`,
    });
    try {
      await send(event);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      report({
        status: 'error',
        total,
        sent: syncedIds.length,
        currentEventId: event.id,
        error,
        message: `Sync paused after ${syncedIds.length}/${total}: ${error}`,
      });
      return { syncedIds, skipped, failed: { eventId: event.id, error } };
    }
    acknowledged.add(event.id);
    syncedIds.push(event.id);
  }
  report({ status: 'complete', total, sent: total, message: `Synchronizing ${plural(total)}… ✓ complete` });
  return { syncedIds, skipped };
}

export interface SyncManager {
  /** Runs a sync; if one is already running, returns that run instead of starting another. */
  sync(events: readonly EngineEvent[]): Promise<SyncResult>;
  readonly running: boolean;
  readonly acknowledged: ReadonlySet<string>;
}

/** Stateful wrapper: remembers acknowledged ids across runs and prevents overlapping runs. */
export function createSyncManager(options: Omit<SyncOptions, 'acknowledged'> = {}): SyncManager {
  const acknowledged = new Set<string>();
  let inFlight: Promise<SyncResult> | null = null;
  return {
    sync(events) {
      if (inFlight) return inFlight;
      inFlight = syncPendingEvents(events, { ...options, acknowledged }).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    get running() {
      return inFlight !== null;
    },
    acknowledged,
  };
}
