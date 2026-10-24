import { describe, expect, it } from 'vitest';
import { createEngineStore, type StoreSnapshot } from '../store';

/** Same flow as scripts/runScenario.ts: 60x, auto-approve, drop T+20, restore T+25. */
async function runDemo(minutes = 90): Promise<StoreSnapshot> {
  const store = createEngineStore({ send: async () => {} });
  for (let m = 0; m <= minutes; m++) {
    store.step(m === 0 ? 0 : 1);
    if (m === 20) store.goOffline();
    if (m === 25) await store.goOnline();
    const top = store.getState().engine.actions.find((a) => a.status === 'proposed');
    if (top) store.approve(top.id);
  }
  const snapshot = store.getState();
  store.destroy();
  return snapshot;
}

describe('full earthquake demo', () => {
  it('protects every at-risk resource and resolves the resident request', async () => {
    const { engine, impact } = await runDemo();
    expect(engine.simTime).toBe(90);
    expect(engine.lostInventory).toEqual([]);
    expect(engine.connection).toBe('online');
    expect(engine.pendingSyncCount).toBe(0);
    expect(engine.roadClosures.map((c) => c.id)).toEqual(['closure-1']);

    expect(impact).toMatchObject({
      label: 'SIMULATION RESULTS',
      completedActions: 5,
      dosesProtected: 37,
      mealsRescued: 243,
      mealsDelivered: 73,
      requestsResolved: 1,
      unitsLost: 0,
      criticalPreservedPercent: 100,
    });
    expect(impact.avgResponseMinutes!).toBeLessThan(impact.baselineResponseMinutes);
    expect(impact.milesAvoided).toBeGreaterThan(0);
  });

  it('reroutes the first approved transfer at T+6 and still beats its deadline', async () => {
    const { engine } = await runDemo();
    const insulin = engine.actions.find((a) => a.needId === 'pharmacy-a-insulin' && a.status === 'completed')!;
    expect(insulin.rerouted).toBe(true);
    expect(insulin.completedAt!).toBeLessThan(insulin.deadlineAt!);
  });

  it('records the T+20–T+25 window as edge events, all synced afterwards', async () => {
    const { engine } = await runDemo();
    const edge = engine.eventLog.filter((e) => e.origin === 'edge');
    expect(edge.length).toBeGreaterThan(0);
    expect(edge.every((e) => e.simTime >= 20 && e.simTime <= 25 && e.synced)).toBe(true);
  });

  it('plays out identically every run', async () => {
    const [a, b] = await Promise.all([runDemo(), runDemo()]);
    expect(a.engine).toEqual(b.engine);
    expect(a.impact).toEqual(b.impact);
  });
});
