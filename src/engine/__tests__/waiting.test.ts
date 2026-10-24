import { describe, expect, it } from 'vitest';
import { approveAction, dispatchEvent, NO_FREE_VOLUNTEER, tick } from '../engine';
import { buildRequest } from '../parserFallback';
import { advanceScenario } from '../scenario';
import { buildScenario } from '../scenarios';
import { createInitialState } from '../seed';
import type { EngineState } from '../types';

function submit(state: EngineState, id: string, text: string): EngineState {
  const { request } = buildRequest({ id, text, lat: 37.3425, lng: -121.8795, locationLabel: 'Downtown', createdAt: state.simTime });
  return dispatchEvent(state, { type: 'REQUEST_SUBMITTED', request: request! });
}

describe('requests waiting for a volunteer', () => {
  // Wildfire + one extra request books all five volunteers, so a second extra request must wait.
  const busy = submit(
    submit(advanceScenario(createInitialState(), buildScenario('wildfire'), 5), 'req-0002', 'My grandmother has no water and the power is out.'),
    'req-0003',
    'There are 3 kids here and we are hungry.',
  );

  it('records why an open request has no proposal', () => {
    const req = busy.requests.find((r) => r.id === 'req-0003')!;
    expect(req.status).toBe('open');
    expect(req.waitingReason).toBe(NO_FREE_VOLUNTEER);
    expect(busy.actions.some((a) => a.toRequestId === 'req-0003')).toBe(false);
  });

  it('matches the request and clears the reason once a volunteer frees up', () => {
    const top = busy.actions.find((a) => a.status === 'proposed')!;
    const after = tick(approveAction(busy, top.id), 20);
    const req = after.requests.find((r) => r.id === 'req-0003')!;
    expect(req.waitingReason).toBeUndefined();
    expect(after.actions.some((a) => a.toRequestId === 'req-0003' && a.status === 'proposed')).toBe(true);
  });

  it('leaves matched requests without a reason', () => {
    expect(busy.requests.find((r) => r.id === 'req-0002')!.waitingReason).toBeUndefined();
  });
});
