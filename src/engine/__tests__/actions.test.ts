import { describe, expect, it } from 'vitest';
import {
  approveAction,
  declineAction,
  dispatchEvent,
  proposalForNeed,
  requestAlternative,
  tick,
} from '../engine';
import { advanceScenario, simulateEarthquake } from '../scenario';
import { createInitialState } from '../seed';
import type { Action, EngineState } from '../types';

const timeline = simulateEarthquake();
const INSULIN_NEED = 'pharmacy-a-insulin';

function atT0(): EngineState {
  return advanceScenario(createInitialState(), timeline, 0);
}

function action(state: EngineState, id: string): Action {
  const a = state.actions.find((x) => x.id === id);
  if (!a) throw new Error(`missing action ${id}`);
  return a;
}

function qty(state: EngineState, facilityId: string, kind: string): number {
  return state.facilities.find((f) => f.id === facilityId)?.inventory.find((i) => i.kind === kind)?.quantity ?? 0;
}

describe('approve → in_progress → completed', () => {
  it('books the volunteer, dispatches on next tick, completes after ETA + loading', () => {
    let s = atT0();
    const top = proposalForNeed(s, INSULIN_NEED)!;
    s = approveAction(s, top.id);

    const approved = action(s, top.id);
    expect(approved.status).toBe('approved');
    expect(approved.completesAt).toBeCloseTo(top.etaMinutes + 5, 9);
    expect(approved.deadlineAt).toBeCloseTo(46, 6);
    expect(s.volunteers.find((v) => v.id === top.volunteerId)?.available).toBe(false);
    expect(s.eventLog.at(-1)?.type).toBe('ACTION_APPROVED');

    s = tick(s, 1);
    expect(action(s, top.id).status).toBe('in_progress');

    s = tick(s, 15);
    const done = action(s, top.id);
    expect(done.status).toBe('completed');
    expect(done.completedAt).toBeCloseTo(approved.completesAt!, 9);
    expect(qty(s, 'pharmacy-a', 'insulin')).toBe(0);
    expect(qty(s, 'community-center-d', 'insulin')).toBe(25);
    expect(s.lostInventory.find((l) => l.kind === 'insulin')).toBeUndefined();

    const vol = s.volunteers.find((v) => v.id === top.volunteerId)!;
    expect(vol.available).toBe(true);
    expect(vol.currentActionId).toBeUndefined();
    expect(vol.lat).toBe(37.3305);
  });

  it('can approve an alternative directly', () => {
    let s = atT0();
    const alt = proposalForNeed(s, INSULIN_NEED)!.alternatives![0]!;
    s = approveAction(s, alt.id);
    expect(action(s, alt.id).status).toBe('approved');
    expect(action(s, alt.id).volunteerId).toBe(alt.volunteerId);
  });

  it('ignores approval of unknown or stale ids', () => {
    const s = atT0();
    expect(approveAction(s, 'nope')).toBe(s);
  });
});

describe('decline / find alternative', () => {
  it('declining promotes the next-best option and never re-proposes the declined combo', () => {
    let s = atT0();
    const first = proposalForNeed(s, INSULIN_NEED)!;
    s = declineAction(s, first.id, 'Volunteer unreachable');
    expect(action(s, first.id).status).toBe('declined');
    expect(action(s, first.id).declineReason).toBe('Volunteer unreachable');

    const next = proposalForNeed(s, INSULIN_NEED)!;
    expect(next.volunteerId).not.toBe(first.volunteerId);
    s = tick(s, 3);
    expect(proposalForNeed(s, INSULIN_NEED)!.id).not.toBe(first.id);
  });

  it('requestAlternative returns the former first alternative as the new proposal', () => {
    let s = atT0();
    const first = proposalForNeed(s, INSULIN_NEED)!;
    const expected = first.alternatives![0]!;
    s = requestAlternative(s, first.id);
    expect(proposalForNeed(s, INSULIN_NEED)!.volunteerId).toBe(expected.volunteerId);
    expect(action(s, first.id).declineReason).toBe('Alternative requested');
  });
});

describe('scenario T+2 / T+4 / T+6', () => {
  it('T+2: Food Bank B meals at risk (~1h30m), Shelter C demand up', () => {
    const s = advanceScenario(atT0(), timeline, 2);
    const meals = s.clocks.find((c) => c.resourceId === 'food-bank-b-meals')!;
    expect(meals.minutesRemaining).toBeCloseTo(90, 6);
    expect(meals.severity).toBe('at_risk');
    expect(s.facilities.find((f) => f.id === 'shelter-c')?.peopleServed).toBe(65);
    expect(proposalForNeed(s, 'food-bank-b-meals')?.quantity).toBe(243);
  });

  it('T+4: resident insulin request is open and vulnerable', () => {
    const s = advanceScenario(atT0(), timeline, 4);
    const req = s.requests.find((r) => r.id === 'req-0001')!;
    expect(req).toMatchObject({ status: 'open', needKind: 'insulin', vulnerable: true, powerAvailable: false });
  });

  it('T+6: road closure reroutes the approved insulin transfer', () => {
    let s = atT0();
    const top = proposalForNeed(s, INSULIN_NEED)!;
    s = approveAction(s, top.id);
    s = advanceScenario(s, timeline, 5);
    const before = action(s, top.id);
    expect(before.rerouted).toBe(false);

    s = advanceScenario(s, timeline, 1);
    const after = action(s, top.id);
    expect(after.rerouted).toBe(true);
    expect(after.etaMinutes).toBeGreaterThan(before.etaMinutes);
    expect(after.completesAt).toBeGreaterThan(before.completesAt!);
    expect(after.atRisk).toBe(false);
    expect(after.explanation).toMatch(/Rerouted around debris on E San Carlos St/);

    s = advanceScenario(s, timeline, 20);
    expect(action(s, top.id).status).toBe('completed');
    expect(qty(s, 'community-center-d', 'insulin')).toBe(25);
  });

  it('serves the insulin request from Community Center D once the rescue lands', () => {
    let s = atT0();
    s = approveAction(s, proposalForNeed(s, INSULIN_NEED)!.id);
    s = advanceScenario(s, timeline, 5);
    expect(proposalForNeed(s, 'req-0001')).toBeUndefined();
    s = advanceScenario(s, timeline, 15);
    const deliver = proposalForNeed(s, 'req-0001')!;
    expect(deliver.type).toBe('deliver');
    expect(deliver.fromFacilityId).toBe('community-center-d');
    s = approveAction(s, deliver.id);
    s = advanceScenario(s, timeline, 30);
    expect(s.requests.find((r) => r.id === 'req-0001')?.status).toBe('resolved');
  });
});

describe('reassignment when a closure makes an in-progress action late', () => {
  it('flags the action at risk and proposes a reroute to another volunteer', () => {
    let s = atT0();
    const top = proposalForNeed(s, INSULIN_NEED)!;
    s = approveAction(s, top.id);
    // Tight deadline: only 0.5 min of slack, and a fast volunteer waiting at Pharmacy A.
    s = {
      ...s,
      actions: s.actions.map((a) => (a.id === top.id ? { ...a, deadlineAt: a.completesAt! + 0.5 } : a)),
      volunteers: [
        ...s.volunteers,
        { id: 'vol-99', name: 'Volunteer #99', lat: 37.3387, lng: -121.8853, vehicle: 'car', capacity: 50, hasCooler: true, available: true },
      ],
    };
    // Closure on Volunteer #01's approach to Pharmacy A only.
    s = dispatchEvent(s, {
      type: 'ROAD_CLOSED',
      closure: { id: 'closure-x', centerLat: 37.34035, centerLng: -121.88765, radiusMiles: 0.05, label: 'gas leak' },
    });

    const original = action(s, top.id);
    expect(original.rerouted).toBe(true);
    expect(original.atRisk).toBe(true);

    const reassign = proposalForNeed(s, `reassign:${top.id}`)!;
    expect(reassign.type).toBe('reroute');
    expect(reassign.replacesActionId).toBe(top.id);
    expect(reassign.volunteerId).toBe('vol-99');
    expect(reassign.explanation).toMatch(/Reassign: Volunteer #99/);

    s = approveAction(s, reassign.id);
    expect(action(s, top.id).status).toBe('cancelled');
    expect(s.volunteers.find((v) => v.id === top.volunteerId)?.available).toBe(true);
    expect(s.volunteers.find((v) => v.id === 'vol-99')?.available).toBe(false);

    s = tick(s, 15);
    expect(action(s, reassign.id).status).toBe('completed');
    expect(qty(s, 'community-center-d', 'insulin')).toBe(25);
  });
});

describe('determinism', () => {
  it('auto-approving the full scenario twice yields identical state', () => {
    const run = () => {
      let s = createInitialState();
      for (let m = 0; m <= 90; m++) {
        s = advanceScenario(s, timeline, m === 0 ? 0 : 1);
        const top = s.actions.find((a) => a.status === 'proposed');
        if (top) s = approveAction(s, top.id);
      }
      return s;
    };
    const a = run();
    expect(a.lostInventory).toHaveLength(0);
    expect(a).toEqual(run());
  });
});
