/**
 * Tiny framework-agnostic store around the pure engine.
 * Drives the simulated clock from a wall-clock interval, but every tick advances
 * a FIXED amount of sim time (speed × tickMs), so runs stay deterministic.
 */
import {
  approveAction,
  declineAction,
  dispatchEvent,
  markEventsSynced,
  requestAlternative,
} from './engine';
import { computeImpact, type ImpactMetrics } from './impact';
import type { EventLog } from './offline/eventLog';
import { replayEventLog } from './offline/eventLog';
import { createSyncManager, type SendEventFn, type SyncProgress, type SyncResult } from './offline/sync';
import { buildRequest, type BuildRequestResult } from './parserFallback';
import { advanceScenario, simulateEarthquake, type ScheduledEvent } from './scenario';
import { createInitialState } from './seed';
import type { EngineEventInput, EngineState } from './types';

export const SPEEDS = [1, 10, 60] as const;
export const DEFAULT_TICK_MS = 250;

export interface StoreSnapshot {
  engine: EngineState;
  impact: ImpactMetrics;
  running: boolean;
  /** Sim minutes per real minute: 1x, 10x, 60x. */
  speed: number;
  sync: SyncProgress;
}

export interface Scheduler {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface EngineStoreOptions {
  timeline?: ScheduledEvent[];
  initialState?: () => EngineState;
  /** Transport for syncing edge events. Defaults to the 800 ms mock. */
  send?: SendEventFn;
  /** Sync automatically when the connection is restored. Default true. */
  autoSync?: boolean;
  /** Persist events here (e.g. createEventLog()). */
  eventLog?: EventLog;
  /** If eventLog has events, rebuild state from it on creation. Default false. */
  rehydrate?: boolean;
  tickMs?: number;
  scheduler?: Scheduler;
}

export interface LocationInput {
  lat: number;
  lng: number;
  locationLabel: string;
}

export interface EngineStore {
  getState(): StoreSnapshot;
  subscribe(listener: () => void): () => void;
  dispatch(input: EngineEventInput): void;
  /** Start (or change speed). Fires due T+0 events immediately. */
  start(speed?: number): void;
  pause(): void;
  reset(): void;
  /** Advance sim time manually (tests, CLI, "step" button). */
  step(dtMinutes: number): void;
  approve(actionId: string): void;
  decline(actionId: string, reason?: string): void;
  requestAlternative(actionId: string): void;
  /** Parse text (Bedrock result if given, else local) and submit it as a request. */
  submitRequestText(text: string, location: LocationInput, bedrock?: unknown): BuildRequestResult;
  goOffline(): void;
  /** Restore the connection and (by default) sync queued edge events. */
  goOnline(): Promise<SyncResult | null>;
  syncNow(): Promise<SyncResult>;
  destroy(): void;
}

const IDLE_SYNC: SyncProgress = { status: 'idle', total: 0, sent: 0, message: '' };

export function createEngineStore(options: EngineStoreOptions = {}): EngineStore {
  const timeline = options.timeline ?? simulateEarthquake();
  const initial = options.initialState ?? createInitialState;
  const tickMs = options.tickMs ?? DEFAULT_TICK_MS;
  const scheduler: Scheduler = options.scheduler ?? {
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>),
  };
  const autoSync = options.autoSync ?? true;
  const log = options.eventLog;

  const makeSyncer = () =>
    createSyncManager({
      ...(options.send ? { send: options.send } : {}),
      onProgress: (sync) => set({ sync }),
    });
  let syncer = makeSyncer();

  const startState =
    options.rehydrate && log && log.all().length > 0 ? replayEventLog(log.all(), { initial: initial() }) : initial();

  let snapshot: StoreSnapshot = {
    engine: startState,
    impact: computeImpact(startState),
    running: false,
    speed: 60,
    sync: IDLE_SYNC,
  };
  let handle: unknown = null;
  let requestSeq = 0;
  const listeners = new Set<() => void>();

  function set(patch: Partial<StoreSnapshot>): void {
    const next = { ...snapshot, ...patch };
    if (patch.engine && patch.engine !== snapshot.engine) {
      next.impact = computeImpact(patch.engine);
      log?.mirror(patch.engine.eventLog);
    }
    snapshot = next;
    for (const l of [...listeners]) l();
  }

  const update = (fn: (s: EngineState) => EngineState) => {
    const engine = fn(snapshot.engine);
    if (engine !== snapshot.engine) set({ engine });
  };

  const step = (dt: number) => update((s) => advanceScenario(s, timeline, dt));

  const stopInterval = () => {
    if (handle !== null) scheduler.clearInterval(handle);
    handle = null;
  };

  async function syncNow(): Promise<SyncResult> {
    const result = await syncer.sync(snapshot.engine.eventLog);
    if (result.syncedIds.length) {
      update((s) => markEventsSynced(s, result.syncedIds));
      log?.markSynced(result.syncedIds);
    }
    return result;
  }

  return {
    getState: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch: (input) => update((s) => dispatchEvent(s, input)),
    start(speed = snapshot.speed) {
      stopInterval();
      step(0);
      const dt = (speed * tickMs) / 60_000;
      handle = scheduler.setInterval(() => step(dt), tickMs);
      set({ running: true, speed });
    },
    pause() {
      stopInterval();
      set({ running: false });
    },
    reset() {
      stopInterval();
      log?.clear();
      syncer = makeSyncer();
      requestSeq = 0;
      const engine = initial();
      snapshot = { ...snapshot, engine, impact: computeImpact(engine), running: false, sync: IDLE_SYNC };
      for (const l of [...listeners]) l();
    },
    step,
    approve: (id) => update((s) => approveAction(s, id)),
    decline: (id, reason) => update((s) => declineAction(s, id, reason)),
    requestAlternative: (id) => update((s) => requestAlternative(s, id)),
    submitRequestText(text, location, bedrock) {
      requestSeq += 1;
      const result = buildRequest({
        id: `req-ui-${String(requestSeq).padStart(4, '0')}`,
        text,
        bedrock,
        ...location,
        createdAt: snapshot.engine.simTime,
      });
      if (result.request) {
        const request = result.request;
        update((s) => dispatchEvent(s, { type: 'REQUEST_SUBMITTED', request }));
      }
      return result;
    },
    goOffline: () => update((s) => (s.connection === 'edge' ? s : dispatchEvent(s, { type: 'CONNECTION_LOST' }))),
    async goOnline() {
      update((s) => (s.connection === 'online' ? s : dispatchEvent(s, { type: 'CONNECTION_RESTORED' })));
      return autoSync ? syncNow() : null;
    },
    syncNow,
    destroy() {
      stopInterval();
      listeners.clear();
    },
  };
}
