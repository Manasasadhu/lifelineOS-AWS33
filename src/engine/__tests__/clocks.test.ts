import { describe, expect, it } from 'vitest';
import {
  coldStorageMinutesRemaining,
  computeClocks,
  severityFor,
  thermalMinutesRemaining,
} from '../clocks';
import { createInitialState } from '../seed';
import { dispatchEvent, tick } from '../engine';
import type { EngineState, Facility } from '../types';

function facility(state: EngineState, id: string): Facility {
  const f = state.facilities.find((x) => x.id === id);
  if (!f) throw new Error(`missing facility ${id}`);
  return f;
}

describe('severityFor', () => {
  it('uses the 60 / 180 / 480 minute thresholds', () => {
    expect(severityFor(0)).toBe('critical');
    expect(severityFor(59.9)).toBe('critical');
    expect(severityFor(60)).toBe('at_risk');
    expect(severityFor(179)).toBe('at_risk');
    expect(severityFor(180)).toBe('warning');
    expect(severityFor(479)).toBe('warning');
    expect(severityFor(480)).toBe('stable');
  });
});

describe('cold storage clock', () => {
  it('computes minutes to unsafe temperature from rise rate', () => {
    expect(
      thermalMinutesRemaining({
        working: false,
        currentTempC: 3.4,
        maxSafeTempC: 8,
        tempRiseRateCPerHour: 6,
        spareCapacityUnits: 0,
      }),
    ).toBeCloseTo(46, 6);
  });

  it('has no countdown while grid-powered and working', () => {
    const state = createInitialState();
    expect(coldStorageMinutesRemaining(facility(state, 'pharmacy-a'))).toBeNull();
  });

  it('counts down only once power is lost / refrigeration fails', () => {
    let state = createInitialState();
    state = dispatchEvent(state, { type: 'POWER_LOST', facilityId: 'pharmacy-a' });
    const insulin = state.clocks.find((c) => c.resourceId === 'pharmacy-a-insulin');
    expect(insulin?.minutesRemaining).toBeCloseTo(46, 6);
    expect(insulin?.severity).toBe('critical');
  });

  it('on backup power = backup minutes + thermal margin', () => {
    let state = createInitialState();
    state = dispatchEvent(state, { type: 'POWER_LOST', facilityId: 'food-bank-b' });
    const b = facility(state, 'food-bank-b');
    expect(b.powerSource).toBe('generator');
    expect(b.hasPower).toBe(true);
    // 6 h generator + 90 min thermal margin.
    expect(coldStorageMinutesRemaining(b)).toBeCloseTo(360 + 90, 6);
  });
});

describe('supply clock', () => {
  it('shelter meals last quantity / consumptionPerHour', () => {
    const state = createInitialState();
    const meals = state.clocks.find((c) => c.resourceId === 'shelter-c-meals:supply');
    expect(meals?.minutesRemaining).toBeCloseTo(300, 6);
    expect(meals?.severity).toBe('warning');
  });

  it('DEMAND_INCREASED scales consumption with headcount', () => {
    let state = createInitialState();
    state = dispatchEvent(state, { type: 'DEMAND_INCREASED', facilityId: 'shelter-c', additionalPeople: 40 });
    const meals = state.clocks.find((c) => c.resourceId === 'shelter-c-meals:supply');
    expect(meals?.minutesRemaining).toBeCloseTo(150, 6);
    expect(meals?.severity).toBe('at_risk');
  });
});

describe('computeClocks', () => {
  it('sorts by minutesRemaining ascending', () => {
    let state = createInitialState();
    state = dispatchEvent(state, { type: 'POWER_LOST', facilityId: 'pharmacy-a' });
    state = dispatchEvent(state, { type: 'POWER_LOST', facilityId: 'community-center-d' });
    const clocks = computeClocks(state);
    for (let i = 1; i < clocks.length; i++) {
      expect(clocks[i]!.minutesRemaining).toBeGreaterThanOrEqual(clocks[i - 1]!.minutesRemaining);
    }
  });
});

describe('tick', () => {
  it('drains backup power and cuts power when it hits zero', () => {
    let state = createInitialState();
    state = dispatchEvent(state, { type: 'POWER_LOST', facilityId: 'community-center-d' });
    state = tick(state, 60);
    expect(facility(state, 'community-center-d').batteryHoursRemaining).toBeCloseTo(16, 6);
    state = tick(state, 16 * 60);
    const d = facility(state, 'community-center-d');
    expect(d.hasPower).toBe(false);
    expect(d.powerSource).toBe('none');
  });

  it('does not mutate the input state', () => {
    let state = createInitialState();
    state = dispatchEvent(state, { type: 'POWER_LOST', facilityId: 'pharmacy-a' });
    const snapshot = structuredClone(state);
    tick(state, 30);
    expect(state).toEqual(snapshot);
  });

  it('gives the same result for one big tick or many small ticks', () => {
    let a = dispatchEvent(createInitialState(), { type: 'POWER_LOST', facilityId: 'pharmacy-a' });
    let b = a;
    a = tick(a, 30);
    for (let i = 0; i < 60; i++) b = tick(b, 0.5);
    const tempA = facility(a, 'pharmacy-a').refrigeration!.currentTempC;
    const tempB = facility(b, 'pharmacy-a').refrigeration!.currentTempC;
    expect(tempA).toBeCloseTo(tempB, 9);
  });
});
