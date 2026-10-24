import { describe, expect, it } from 'vitest';
import { createInitialState } from '../seed';
import { advanceScenario, simulateEarthquake } from '../scenario';
import { applyEvent } from '../engine';
import type { EngineState } from '../types';

const timeline = simulateEarthquake();

function start(): EngineState {
  return advanceScenario(createInitialState(), timeline, 0);
}

function status(state: EngineState, id: string) {
  return state.facilities.find((f) => f.id === id)?.status;
}

describe('earthquake scenario — T+0', () => {
  it('starts the disaster and puts Pharmacy A in critical with ~46 min left', () => {
    const state = start();
    expect(state.disaster?.magnitude).toBe(7);
    expect(status(state, 'pharmacy-a')).toBe('critical');

    const top = state.clocks[0]!;
    expect(top.facilityId).toBe('pharmacy-a');
    expect(top.kind).toBe('cold_storage');
    expect(top.minutesRemaining).toBeCloseTo(46, 6);
  });

  it('switches Food Bank B and Community Center D onto generators', () => {
    const state = start();
    const b = state.facilities.find((f) => f.id === 'food-bank-b')!;
    const d = state.facilities.find((f) => f.id === 'community-center-d')!;
    expect(b.powerSource).toBe('generator');
    expect(d.powerSource).toBe('generator');
    const dPower = state.clocks.find((c) => c.resourceId === 'community-center-d:power');
    expect(dPower?.minutesRemaining).toBeCloseTo(17 * 60, 6);
  });

  it('survival clocks count down with sim time', () => {
    const state = advanceScenario(start(), timeline, 10);
    expect(state.simTime).toBe(10);
    const insulin = state.clocks.find((c) => c.resourceId === 'pharmacy-a-insulin');
    expect(insulin?.minutesRemaining).toBeCloseTo(36, 6);
  });

  it('marks Pharmacy A cold stock as lost at T+46 if nobody acts', () => {
    const before = advanceScenario(start(), timeline, 45);
    expect(before.lostInventory).toHaveLength(0);

    const after = advanceScenario(before, timeline, 1);
    const lostInsulin = after.lostInventory.find((l) => l.itemId === 'pharmacy-a-insulin');
    expect(lostInsulin?.quantity).toBe(25);
    expect(lostInsulin?.simTime).toBeCloseTo(46, 6);
    expect(after.clocks.some((c) => c.facilityId === 'pharmacy-a')).toBe(false);
    expect(status(after, 'pharmacy-a')).toBe('limited');
  });

  it('applies scheduled events once, even when replayed', () => {
    const state = start();
    const replayed = state.eventLog.reduce(applyEvent, state);
    expect(replayed.eventLog).toHaveLength(state.eventLog.length);
    expect(replayed).toEqual(state);
  });

  it('is deterministic across runs', () => {
    const run = () => advanceScenario(start(), timeline, 120);
    expect(run()).toEqual(run());
  });
});
