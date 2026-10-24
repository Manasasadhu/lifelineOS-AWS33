import { describe, expect, it } from 'vitest';
import { infeasibilityReason, scorePriority } from '../priority';
import { planTrip } from '../routing';
import type { PriorityInput } from '../priority';
import type { Volunteer } from '../types';

const base: PriorityInput = {
  urgency: 'critical',
  peopleAffected: 25,
  vulnerable: true,
  minutesRemaining: 46,
  itemKind: 'insulin',
  distanceMiles: 2,
  detourPenalty: 0,
};

describe('scorePriority', () => {
  it('matches the documented formula and returns every factor', () => {
    const { score, breakdown } = scorePriority(base);
    const expected = (10 * Math.log2(26) * 1.5 * (60 / 46) * 3) / (1 + 2 + 0);
    expect(score).toBeCloseTo(expected, 9);
    expect(breakdown).toMatchObject({
      urgencyWeight: 10,
      vulnerabilityMultiplier: 1.5,
      resourceCriticality: 3,
      denominator: 3,
    });
    expect(breakdown.timePressure).toBeCloseTo(60 / 46, 9);
  });

  it('clamps time pressure at 5 minutes', () => {
    expect(scorePriority({ ...base, minutesRemaining: 1 }).breakdown.timePressure).toBe(12);
  });

  it('ranks closer, more urgent, more vulnerable needs higher', () => {
    const s = (o: Partial<PriorityInput>) => scorePriority({ ...base, ...o }).score;
    expect(s({})).toBeGreaterThan(s({ distanceMiles: 4 }));
    expect(s({})).toBeGreaterThan(s({ detourPenalty: 1 }));
    expect(s({})).toBeGreaterThan(s({ urgency: 'high' }));
    expect(s({})).toBeGreaterThan(s({ vulnerable: false }));
    expect(s({})).toBeGreaterThan(s({ itemKind: 'meals' }));
  });
});

describe('infeasibilityReason', () => {
  const vol: Volunteer = { id: 'v', name: 'Volunteer #99', lat: 37.335, lng: -121.88, vehicle: 'car', capacity: 30, hasCooler: false, available: true };
  const near = planTrip(vol, { lat: 37.336, lng: -121.881 }, { lat: 37.338, lng: -121.883 }, []);
  const far = planTrip(vol, { lat: 37.336, lng: -121.881 }, { lat: 37.39, lng: -121.95 }, []);
  const ok = { trip: near, volunteer: vol, quantity: 25, minutesRemaining: 46, requiresColdStorage: true };

  it('accepts a short cold trip without a cooler', () => {
    expect(infeasibilityReason(ok)).toBeNull();
  });

  it('rejects over capacity', () => {
    expect(infeasibilityReason({ ...ok, quantity: 31 })).toMatch(/can carry 30/);
  });

  it('rejects when ETA + loading buffer misses the deadline', () => {
    expect(infeasibilityReason({ ...ok, minutesRemaining: near.etaMinutes + 4 })).toMatch(/arrives in/);
  });

  it('rejects long cold trips without a cooler, allows them with one', () => {
    const longCold = { ...ok, trip: far, minutesRemaining: 500 };
    expect(infeasibilityReason(longCold)).toMatch(/no cooler/);
    expect(infeasibilityReason({ ...longCold, volunteer: { ...vol, hasCooler: true } })).toBeNull();
  });
});
