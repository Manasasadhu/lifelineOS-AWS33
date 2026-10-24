import { afterEach, describe, expect, it, vi } from 'vitest';
import { approveAction, dispatchEvent, markEventsSynced } from '../engine';
import { createEventLog, createMemoryStorage, replayEventLog, type KeyValueStorage } from '../offline/eventLog';
import { createMockSend, createSyncManager, syncPendingEvents, type SyncProgress } from '../offline/sync';
import { buildRequest } from '../parserFallback';
import { advanceScenario, simulateEarthquake } from '../scenario';
import { createInitialState } from '../seed';
import type { EngineEvent, EngineState } from '../types';

const timeline = simulateEarthquake();

/** Minute-by-minute run with auto-approve; optional connection drop window. */
function run(until: number, outage?: { from: number; to: number }): EngineState {
  let s = createInitialState();
  for (let m = 0; m <= until; m++) {
    s = advanceScenario(s, timeline, m === 0 ? 0 : 1);
    if (outage && m === outage.from) s = dispatchEvent(s, { type: 'CONNECTION_LOST' });
    if (outage && m === outage.to) s = dispatchEvent(s, { type: 'CONNECTION_RESTORED' });
    const top = s.actions.find((a) => a.status === 'proposed');
    if (top) s = approveAction(s, top.id);
  }
  return s;
}

describe('edge mode', () => {
  it('keeps running locally and records new events as edge / unsynced', () => {
    const s = run(20, { from: 1, to: 999 });
    expect(s.connection).toBe('edge');
    const edge = s.eventLog.filter((e) => e.origin === 'edge');
    expect(edge.length).toBeGreaterThan(5);
    expect(edge.every((e) => !e.synced)).toBe(true);
    expect(s.pendingSyncCount).toBe(edge.length);
    // Clocks, matcher and approvals all kept working offline.
    expect(edge.some((e) => e.type === 'REQUEST_SUBMITTED')).toBe(true);
    expect(edge.some((e) => e.type === 'ACTION_APPROVED')).toBe(true);
    expect(edge.some((e) => e.type === 'ACTION_COMPLETED')).toBe(true);
    expect(s.clocks.length).toBeGreaterThan(0);
  });

  it('events before the outage stay cloud / synced', () => {
    const s = run(5, { from: 3, to: 999 });
    const lostAt = s.eventLog.findIndex((e) => e.type === 'CONNECTION_LOST');
    expect(s.eventLog.slice(0, lostAt + 1).every((e) => e.origin === 'cloud' && e.synced)).toBe(true);
  });

  it('parser fallback works offline to submit a request', () => {
    let s = dispatchEvent(createInitialState(), { type: 'CONNECTION_LOST' });
    const { request } = buildRequest({ id: 'req-x', text: 'need water for 4 people', lat: 37.34, lng: -121.88, locationLabel: 'near SJSU', createdAt: 0 });
    s = dispatchEvent(s, { type: 'REQUEST_SUBMITTED', request: request! });
    expect(s.eventLog.at(-1)).toMatchObject({ origin: 'edge', synced: false });
    expect(s.pendingSyncCount).toBe(1);
  });

  it('is deterministic with an outage', () => {
    expect(run(40, { from: 20, to: 25 })).toEqual(run(40, { from: 20, to: 25 }));
  });
});

describe('event log persistence', () => {
  const event = (id: string, synced = false): EngineEvent => ({ id, type: 'CONNECTION_LOST', simTime: 0, origin: 'edge', synced });

  it('persists to storage and reloads', () => {
    const storage = createMemoryStorage();
    const log = createEventLog({ storage });
    log.append([event('a'), event('b')]);
    log.append(event('a'));
    const reloaded = createEventLog({ storage });
    expect(reloaded.all().map((e) => e.id)).toEqual(['a', 'b']);
    expect(reloaded.pending()).toHaveLength(2);
  });

  it('mirror() appends new events and picks up synced flags', () => {
    const log = createEventLog({ storage: createMemoryStorage() });
    log.mirror([event('a'), event('b')]);
    log.mirror([event('a', true), event('b'), event('c')]);
    expect(log.all().map((e) => [e.id, e.synced])).toEqual([['a', true], ['b', false], ['c', false]]);
  });

  it('falls back to memory when storage throws', () => {
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    const log = createEventLog({ storage: broken });
    log.append(event('a'));
    expect(log.all()).toHaveLength(1);
    expect(log.persisted).toBe(false);
  });

  it('ignores corrupt stored data', () => {
    const storage = createMemoryStorage();
    storage.setItem('lifeline.eventLog.v1', '{not json');
    expect(createEventLog({ storage }).all()).toEqual([]);
  });

  it('works without localStorage (Node / Lambda)', () => {
    const log = createEventLog();
    log.append(event('a'));
    expect(log.all()).toHaveLength(1);
  });

  it('replays a persisted log back into the same engine state', () => {
    const live = run(30, { from: 10, to: 999 });
    const log = createEventLog({ storage: createMemoryStorage() });
    log.mirror(live.eventLog);
    const restored = replayEventLog(log.all(), { untilSimTime: live.simTime });
    expect(restored.eventLog).toEqual(live.eventLog);
    expect(restored.pendingSyncCount).toBe(live.pendingSyncCount);
    expect(restored.actions.map((a) => [a.id, a.status])).toEqual(live.actions.map((a) => [a.id, a.status]));
    expect(restored.requests).toEqual(live.requests);
  });
});

describe('syncPendingEvents', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends pending events in order, reports progress, and marks them synced', async () => {
    let s = run(30, { from: 20, to: 25 });
    const pending = s.eventLog.filter((e) => !e.synced);
    expect(pending.length).toBeGreaterThan(0);

    const sent: string[] = [];
    const progress: SyncProgress[] = [];
    const result = await syncPendingEvents(s.eventLog, {
      send: async (e) => void sent.push(e.id),
      onProgress: (p) => progress.push(p),
    });

    expect(sent).toEqual(pending.map((e) => e.id));
    expect(result.syncedIds).toEqual(sent);
    expect(progress[0]!.message).toBe(`Synchronizing ${pending.length} offline events…`);
    expect(progress.at(-1)).toMatchObject({ status: 'complete', sent: pending.length });
    expect(progress.at(-1)!.message).toMatch(/✓ complete$/);

    s = markEventsSynced(s, result.syncedIds);
    expect(s.pendingSyncCount).toBe(0);
  });

  it('is idempotent by event id', async () => {
    const events: EngineEvent[] = [
      { id: 'e1', type: 'CONNECTION_LOST', simTime: 0, origin: 'edge', synced: false },
      { id: 'e1', type: 'CONNECTION_LOST', simTime: 0, origin: 'edge', synced: false },
      { id: 'e2', type: 'CONNECTION_RESTORED', simTime: 1, origin: 'edge', synced: false },
    ];
    const send = vi.fn(async () => {});
    const manager = createSyncManager({ send });
    await manager.sync(events);
    await manager.sync(events);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('stops at the first failure and resumes from there', async () => {
    const events: EngineEvent[] = ['e1', 'e2', 'e3'].map((id, i) => ({
      id,
      type: 'CONNECTION_LOST',
      simTime: i,
      origin: 'edge',
      synced: false,
    }));
    let fail = true;
    const sent: string[] = [];
    const manager = createSyncManager({
      send: async (e) => {
        if (e.id === 'e2' && fail) throw new Error('503');
        sent.push(e.id);
      },
    });
    const first = await manager.sync(events);
    expect(first.failed).toEqual({ eventId: 'e2', error: '503' });
    expect(first.syncedIds).toEqual(['e1']);

    fail = false;
    const second = await manager.sync(events);
    expect(second.syncedIds).toEqual(['e2', 'e3']);
    expect(second.skipped).toBe(1);
    expect(sent).toEqual(['e1', 'e2', 'e3']);
  });

  it('does not start overlapping runs', async () => {
    const manager = createSyncManager({ send: async () => {} });
    const events: EngineEvent[] = [{ id: 'e1', type: 'CONNECTION_LOST', simTime: 0, origin: 'edge', synced: false }];
    const a = manager.sync(events);
    const b = manager.sync(events);
    expect(a).toBe(b);
    await a;
  });

  it('default mock transport resolves after 800 ms per event', async () => {
    vi.useFakeTimers();
    const events: EngineEvent[] = ['e1', 'e2'].map((id) => ({ id, type: 'CONNECTION_LOST', simTime: 0, origin: 'edge', synced: false }));
    const promise = syncPendingEvents(events, { send: createMockSend() });
    let done = false;
    void promise.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1599);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });
});
