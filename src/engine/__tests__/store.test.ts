import { describe, expect, it, vi } from 'vitest';
import { createEventLog, createMemoryStorage } from '../offline/eventLog';
import { createEngineStore, type Scheduler } from '../store';

function manualScheduler() {
  let fn: (() => void) | null = null;
  const scheduler: Scheduler = {
    setInterval: (f) => {
      fn = f;
      return 1;
    },
    clearInterval: () => {
      fn = null;
    },
  };
  return {
    scheduler,
    fire: (n = 1) => {
      for (let i = 0; i < n; i++) fn?.();
    },
    get active() {
      return fn !== null;
    },
  };
}

const instantSend = async () => {};

describe('createEngineStore', () => {
  it('start() fires T+0 events and advances speed × tickMs of sim time per tick', () => {
    const clock = manualScheduler();
    const store = createEngineStore({ scheduler: clock.scheduler, tickMs: 1000 });
    store.start(60);
    expect(store.getState().running).toBe(true);
    expect(store.getState().engine.disaster?.magnitude).toBe(7);
    clock.fire(10);
    expect(store.getState().engine.simTime).toBeCloseTo(10, 9);

    store.start(10);
    clock.fire(6);
    expect(store.getState().engine.simTime).toBeCloseTo(11, 9);
  });

  it('pause() stops ticking; reset() returns to T+0', () => {
    const clock = manualScheduler();
    const store = createEngineStore({ scheduler: clock.scheduler, tickMs: 1000 });
    store.start(60);
    clock.fire(5);
    store.pause();
    expect(clock.active).toBe(false);
    expect(store.getState().running).toBe(false);
    store.reset();
    expect(store.getState().engine.simTime).toBe(0);
    expect(store.getState().engine.eventLog).toHaveLength(0);
  });

  it('notifies subscribers and keeps a stable snapshot between changes', () => {
    const store = createEngineStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const before = store.getState();
    expect(store.getState()).toBe(before);
    store.step(1);
    expect(listener).toHaveBeenCalled();
    expect(store.getState()).not.toBe(before);
    unsubscribe();
    listener.mockClear();
    store.step(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('approve / decline / requestAlternative go through the engine', () => {
    const store = createEngineStore();
    store.step(0);
    const top = store.getState().engine.actions.find((a) => a.status === 'proposed')!;
    store.requestAlternative(top.id);
    const next = store.getState().engine.actions.find((a) => a.status === 'proposed' && a.needId === top.needId)!;
    expect(next.volunteerId).not.toBe(top.volunteerId);
    store.approve(next.id);
    expect(store.getState().engine.actions.find((a) => a.id === next.id)?.status).toBe('approved');
  });

  it('submitRequestText parses locally and submits a request', () => {
    const store = createEngineStore();
    const result = store.submitRequestText('family of 4 needs water', { lat: 37.34, lng: -121.88, locationLabel: 'near SJSU' });
    expect(result.request?.needKind).toBe('water');
    expect(store.getState().engine.requests).toHaveLength(1);
  });

  it('goOffline → edge events queue; goOnline → auto-sync clears them', async () => {
    const store = createEngineStore({ send: instantSend });
    store.step(0);
    store.goOffline();
    store.step(5);
    expect(store.getState().engine.connection).toBe('edge');
    expect(store.getState().engine.pendingSyncCount).toBeGreaterThan(0);
    const result = await store.goOnline();
    expect(result?.syncedIds.length).toBeGreaterThan(0);
    expect(store.getState().engine.pendingSyncCount).toBe(0);
    expect(store.getState().sync.status).toBe('complete');
  });

  it('mirrors to an event log and can rehydrate from it', () => {
    const log = createEventLog({ storage: createMemoryStorage() });
    const a = createEngineStore({ eventLog: log });
    a.step(0);
    a.goOffline();
    a.step(10);
    expect(log.all()).toEqual(a.getState().engine.eventLog);

    const b = createEngineStore({ eventLog: log, rehydrate: true });
    expect(b.getState().engine.eventLog).toEqual(a.getState().engine.eventLog);
    expect(b.getState().engine.connection).toBe('edge');
  });
});
