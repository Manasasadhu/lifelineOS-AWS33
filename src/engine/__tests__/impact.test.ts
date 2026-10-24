import { describe, expect, it } from 'vitest';
import { approveAction } from '../engine';
import { BASELINE_MANUAL_RESPONSE_MINUTES, computeImpact, IMPACT_LABEL } from '../impact';
import { advanceScenario, simulateEarthquake } from '../scenario';
import { createInitialState } from '../seed';

const timeline = simulateEarthquake();

describe('computeImpact', () => {
  it('is all zeros / nulls before anything happens', () => {
    const i = computeImpact(createInitialState());
    expect(i).toMatchObject({
      label: IMPACT_LABEL,
      completedActions: 0,
      dosesProtected: 0,
      mealsRescued: 0,
      avgResponseMinutes: null,
      criticalPreservedPercent: null,
      baselineResponseMinutes: BASELINE_MANUAL_RESPONSE_MINUTES,
    });
  });

  it('counts only completed actions, not approved or proposed ones', () => {
    let s = advanceScenario(createInitialState(), timeline, 0);
    s = approveAction(s, s.actions.find((a) => a.status === 'proposed')!.id);
    expect(computeImpact(s).dosesProtected).toBe(0);
    s = advanceScenario(s, timeline, 20);
    expect(computeImpact(s).dosesProtected).toBe(25);
  });

  it('with no intervention: everything at risk is lost, 0% preserved', () => {
    const s = advanceScenario(createInitialState(), timeline, 120);
    const i = computeImpact(s);
    expect(i.unitsLost).toBe(25 + 12 + 243);
    expect(i.lostByKind).toEqual({ insulin: 25, medication: 12, meals: 243 });
    expect(i.criticalPreservedPercent).toBe(0);
  });

  it('never double counts a dose that was rescued and then delivered', () => {
    let s = advanceScenario(createInitialState(), timeline, 0);
    for (let m = 1; m <= 60; m++) {
      const top = s.actions.find((a) => a.status === 'proposed');
      if (top) s = approveAction(s, top.id);
      s = advanceScenario(s, timeline, 1);
    }
    const i = computeImpact(s);
    expect(s.requests[0]?.status).toBe('resolved');
    expect(i.dosesProtected).toBe(37);
    expect(i.requestsResolved).toBe(1);
  });
});
