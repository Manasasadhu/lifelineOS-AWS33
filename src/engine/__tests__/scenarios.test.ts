import { describe, expect, it } from 'vitest';
import { createInitialState } from '../seed';
import { advanceScenario } from '../scenario';
import { DISASTER_SCENARIOS, buildScenario, isDisasterType } from '../scenarios';
import type { DisasterType, EngineState } from '../types';

function playTo(id: DisasterType, minutes: number): EngineState {
  return advanceScenario(createInitialState(), buildScenario(id), minutes);
}

const proposals = (s: EngineState) => s.actions.filter((a) => a.status === 'proposed');

describe('disaster scenario catalogue', () => {
  it('offers five distinct scenarios', () => {
    expect(DISASTER_SCENARIOS.map((s) => s.id)).toEqual(['earthquake', 'wildfire', 'flood', 'heatwave', 'grid_failure']);
  });

  it('validates scenario ids', () => {
    expect(isDisasterType('flood')).toBe(true);
    expect(isDisasterType('tsunami')).toBe(false);
    expect(() => buildScenario('tsunami' as DisasterType)).toThrow(/Unknown disaster scenario/);
  });

  it('gives every scheduled event a unique id across all scenarios', () => {
    const ids = DISASTER_SCENARIOS.flatMap((s) => s.build().map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe.each(DISASTER_SCENARIOS.map((s) => s.id))('%s scenario', (id) => {
  it('starts the matching disaster at T+0', () => {
    const state = playTo(id, 0);
    expect(state.disaster?.type).toBe(id);
    expect(state.clocks.some((c) => c.severity !== 'stable')).toBe(true);
  });

  it('injects one resident request at T+4 and a road closure by T+6', () => {
    expect(playTo(id, 3).requests).toHaveLength(0);
    expect(playTo(id, 4).requests).toHaveLength(1);
    expect(playTo(id, 6).roadClosures.length).toBeGreaterThan(0);
  });

  it('reroutes at least one proposal around the closure', () => {
    expect(proposals(playTo(id, 7)).some((a) => a.rerouted)).toBe(true);
  });

  // The earthquake's insulin request waits for the pharmacy rescue to finish, so it is covered in actions.test.ts.
  it.skipIf(id === 'earthquake')('proposes a response for the resident request right away', () => {
    expect(proposals(playTo(id, 7)).some((a) => a.toRequestId === 'req-0001')).toBe(true);
  });

  it('is deterministic', () => {
    expect(playTo(id, 30)).toEqual(playTo(id, 30));
  });
});
