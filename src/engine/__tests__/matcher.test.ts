import { describe, expect, it } from 'vitest';
import { generateActions } from '../matcher';
import { advanceScenario, simulateEarthquake } from '../scenario';
import { createInitialState } from '../seed';
import type { Action, EngineState } from '../types';

function atT0(): EngineState {
  return advanceScenario(createInitialState(), simulateEarthquake(), 0);
}

function proposals(state: EngineState): Action[] {
  return state.actions.filter((a) => a.status === 'proposed');
}

describe('matcher — T+0 earthquake', () => {
  it('proposes the insulin rescue first: Pharmacy A → Community Center D', () => {
    const top = proposals(atT0())[0]!;
    expect(top.type).toBe('transfer');
    expect(top.itemKind).toBe('insulin');
    expect(top.quantity).toBe(25);
    expect(top.fromFacilityId).toBe('pharmacy-a');
    expect(top.toFacilityId).toBe('community-center-d');
    expect(top.etaMinutes + 5).toBeLessThan(top.deadlineMinutes);
    expect(top.impact.dosesProtected).toBe(25);
    expect(top.explanation).toMatch(/^Pharmacy A refrigeration fails in 46 min\. Community Center D has cold storage for 17 hrs/);
    expect(top.explanation).toMatch(/Protects 25 insulin doses\.$/);
  });

  it('includes a score breakdown that reproduces the score', () => {
    const { priorityScore, scoreBreakdown: b } = proposals(atT0())[0]!;
    expect(b.numerator / b.denominator).toBeCloseTo(priorityScore, 9);
    expect(b.urgencyWeight).toBe(10);
    expect(b.vulnerabilityMultiplier).toBe(1.5);
    expect(b.resourceCriticality).toBe(3);
  });

  it('offers 2 alternatives with different volunteers, ranked below the proposal', () => {
    const top = proposals(atT0())[0]!;
    expect(top.alternatives).toHaveLength(2);
    for (const alt of top.alternatives!) {
      expect(alt.volunteerId).not.toBe(top.volunteerId);
      expect(alt.priorityScore).toBeLessThanOrEqual(top.priorityScore);
    }
  });

  it('lists rejected options with reasons (bike over capacity)', () => {
    const top = proposals(atT0())[0]!;
    expect(top.rejectedOptions).toContainEqual(
      expect.objectContaining({ volunteerId: 'vol-03', reason: expect.stringMatching(/can carry 20, needs 25/) }),
    );
  });

  it('never double-books a volunteer or over-allocates inventory', () => {
    const list = proposals(atT0());
    const vols = list.map((a) => a.volunteerId);
    expect(new Set(vols).size).toBe(vols.length);
    const insulinOut = list.filter((a) => a.fromFacilityId === 'pharmacy-a' && a.itemKind === 'insulin');
    expect(insulinOut.reduce((n, a) => n + a.quantity, 0)).toBeLessThanOrEqual(25);
  });

  it('sorts proposals by score, highest first', () => {
    const scores = proposals(atT0()).map((a) => a.priorityScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('proposes resupply for Shelter C meals from a facility with spare stock', () => {
    const resupply = proposals(atT0()).find((a) => a.toFacilityId === 'shelter-c' && a.itemKind === 'meals');
    expect(resupply).toBeDefined();
    expect(resupply!.fromFacilityId).toBe('grocery-e');
  });

  it('reroutes and penalises a trip through a road closure', () => {
    const state = atT0();
    const before = proposals(state)[0]!;
    // Midpoint of the Pharmacy A → Community Center D leg.
    const withClosure = generateActions({
      ...state,
      roadClosures: [{ id: 'rc-test', centerLat: 37.3346, centerLng: -121.875, radiusMiles: 0.3, label: 'Test closure' }],
    }).actions.find((a) => a.itemKind === 'insulin')!;
    expect(withClosure.rerouted).toBe(true);
    expect(withClosure.scoreBreakdown.detourPenalty).toBeGreaterThan(0);
    expect(withClosure.explanation).toMatch(/Rerouted around Test closure/);
    expect(withClosure.priorityScore).toBeLessThan(before.priorityScore);
  });

  it('is deterministic', () => {
    expect(proposals(atT0())).toEqual(proposals(atT0()));
  });

  it('keeps proposal ids stable across ticks', () => {
    const t0 = proposals(atT0())[0]!;
    const t5 = proposals(advanceScenario(atT0(), simulateEarthquake(), 5))[0]!;
    expect(t5.id).toBe(t0.id);
    expect(t5.createdAt).toBe(0);
    expect(t5.priorityScore).toBeGreaterThan(t0.priorityScore);
  });
});
