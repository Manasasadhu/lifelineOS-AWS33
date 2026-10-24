/**
 * Scripted M7.0 earthquake, downtown San José.
 * Fixed event ids and times, so the scenario plays out identically every run.
 * CONNECTION_LOST / CONNECTION_RESTORED come from UI buttons, not this script.
 */
import { applyEvent, stampEvent, tick } from './engine';
import { buildRequest } from './parserFallback';
import type { EngineEventInput, EngineState, NeedRequest } from './types';

export interface ScheduledEvent {
  /** Stable id so re-running or replaying never double-applies. */
  id: string;
  /** Sim minute the event fires. */
  at: number;
  event: EngineEventInput;
}

export interface ScenarioOptions {
  /** Bedrock's ParsedRequest for the scenario's resident text. Omitted or invalid → local keyword parser. */
  bedrockParse?: unknown;
}

export type EarthquakeOptions = ScenarioOptions;

export function simulateEarthquake(options: EarthquakeOptions = {}): ScheduledEvent[] {
  const residentRequest = scriptedRequest({
    text: GRANDMOTHER_REQUEST_TEXT,
    bedrockParse: options.bedrockParse,
    lat: 37.3425,
    lng: -121.8795,
    locationLabel: 'near N 6th St & E St John St',
    createdAt: 4,
  });
  return [
    // T+0 — quake hits, grid drops across downtown.
    {
      id: 'quake-t0-disaster',
      at: 0,
      event: {
        type: 'DISASTER_STARTED',
        disasterType: 'earthquake',
        magnitude: 7.0,
        label: 'M7.0 earthquake — downtown San José',
      },
    },
    { id: 'quake-t0-power-pharmacy-a', at: 0, event: { type: 'POWER_LOST', facilityId: 'pharmacy-a' } },
    { id: 'quake-t0-power-food-bank-b', at: 0, event: { type: 'POWER_LOST', facilityId: 'food-bank-b' } },
    // Community Center D loses grid too, but its generator takes over (~17 h).
    { id: 'quake-t0-power-community-center-d', at: 0, event: { type: 'POWER_LOST', facilityId: 'community-center-d' } },
    { id: 'quake-t0-fridge-pharmacy-a', at: 0, event: { type: 'REFRIGERATION_FAILED', facilityId: 'pharmacy-a' } },

    // T+2 — Food Bank B's cooler compressor fails (243 meals, ~1h30m). Evacuees arrive at Shelter C.
    { id: 'quake-t2-fridge-food-bank-b', at: 2, event: { type: 'REFRIGERATION_FAILED', facilityId: 'food-bank-b' } },
    { id: 'quake-t2-demand-shelter-c', at: 2, event: { type: 'DEMAND_INCREASED', facilityId: 'shelter-c', additionalPeople: 25 } },

    // T+4 — resident request.
    { id: 'quake-t4-request-insulin', at: 4, event: { type: 'REQUEST_SUBMITTED', request: residentRequest } },

    // T+6 — debris closes the road between Pharmacy A and Community Center D,
    // i.e. on the route of the first approved transfer (the insulin rescue).
    {
      id: 'quake-t6-road-closed',
      at: 6,
      event: {
        type: 'ROAD_CLOSED',
        closure: {
          id: 'closure-1',
          centerLat: 37.3346,
          centerLng: -121.8752,
          radiusMiles: 0.25,
          label: 'debris on E San Carlos St',
        },
      },
    },
  ];
}

export const GRANDMOTHER_REQUEST_TEXT = 'My grandmother needs insulin and we have no electricity.';

export interface ScriptedRequestInput {
  text: string;
  bedrockParse?: unknown;
  lat: number;
  lng: number;
  locationLabel: string;
  createdAt: number;
}

/** The resident request a scenario injects. Each scenario has exactly one, so the id is fixed. */
export function scriptedRequest(input: ScriptedRequestInput): NeedRequest {
  const { request } = buildRequest({
    id: 'req-0001',
    text: input.text,
    bedrock: input.bedrockParse,
    lat: input.lat,
    lng: input.lng,
    locationLabel: input.locationLabel,
    createdAt: input.createdAt,
  });
  if (!request) throw new Error('Scenario request could not be parsed');
  return request;
}

/** Apply every scheduled event due at or before the current sim time that hasn't been applied yet. */
export function applyDueEvents(state: EngineState, timeline: readonly ScheduledEvent[]): EngineState {
  let next = state;
  for (const scheduled of timeline) {
    if (scheduled.at > next.simTime) continue;
    if (next.eventLog.some((e) => e.id === scheduled.id)) continue;
    next = applyEvent(next, stampEvent(next, scheduled.event, { id: scheduled.id, simTime: scheduled.at }));
  }
  return next;
}

/**
 * Advance the sim by dtMinutes, firing scheduled events at their exact minute.
 * Ticks are split at event times so an event at T+2 is never applied late.
 */
export function advanceScenario(
  state: EngineState,
  timeline: readonly ScheduledEvent[],
  dtMinutes: number,
): EngineState {
  const target = state.simTime + dtMinutes;
  let next = applyDueEvents(state, timeline);
  while (next.simTime < target - 1e-9) {
    const upcoming = timeline
      .filter((s) => s.at > next.simTime && s.at <= target)
      .reduce((min, s) => Math.min(min, s.at), target);
    next = applyDueEvents(tick(next, upcoming - next.simTime), timeline);
  }
  return next;
}
