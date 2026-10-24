/**
 * Catalogue of scripted disasters. Each scenario is a fixed timeline built only from
 * existing engine events, so they all replay identically and share one clock model.
 * Every scenario has one resident request at T+4 and a road closure at T+6.
 */
import { scriptedRequest, simulateEarthquake, type ScenarioOptions, type ScheduledEvent } from './scenario';
import type { DisasterType } from './types';

export interface ScenarioDefinition {
  id: DisasterType;
  name: string;
  summary: string;
  build: (options?: ScenarioOptions) => ScheduledEvent[];
}

export const WILDFIRE_REQUEST_TEXT =
  'We evacuated from the fire with our two kids and have no food. We need meals urgently.';
export const FLOOD_REQUEST_TEXT =
  'Water came into our apartment. Two kids and my elderly mother need clean drinking water.';
export const HEATWAVE_REQUEST_TEXT =
  'My elderly neighbor has no AC, the power is out and she is dizzy. She needs water right now.';
export const GRID_FAILURE_REQUEST_TEXT =
  'Power is out and my elderly dad is freezing. He needs blankets tonight.';

/**
 * Wildfire in the east foothills: evacuees pour into Shelter C, PG&E cuts power to
 * Pharmacy A as a safety shutoff, and fire crews close a road on the resupply route.
 */
export function simulateWildfire(options: ScenarioOptions = {}): ScheduledEvent[] {
  return [
    {
      id: 'fire-t0-disaster',
      at: 0,
      event: {
        type: 'DISASTER_STARTED',
        disasterType: 'wildfire',
        magnitude: 285,
        label: 'Wildfire in the east foothills — AQI 285, evacuations under way',
      },
    },
    { id: 'fire-t0-psps-pharmacy-a', at: 0, event: { type: 'POWER_LOST', facilityId: 'pharmacy-a' } },
    { id: 'fire-t0-evacuees-shelter-c', at: 0, event: { type: 'DEMAND_INCREASED', facilityId: 'shelter-c', additionalPeople: 60 } },

    // T+2 — Shelter C hands out water to arriving evacuees.
    {
      id: 'fire-t2-water-shelter-c',
      at: 2,
      event: { type: 'INVENTORY_CHANGED', facilityId: 'shelter-c', itemKind: 'water', delta: -40, reason: 'Handed out to evacuees' },
    },

    {
      id: 'fire-t4-request-meals',
      at: 4,
      event: {
        type: 'REQUEST_SUBMITTED',
        request: scriptedRequest({
          text: WILDFIRE_REQUEST_TEXT,
          bedrockParse: options.bedrockParse,
          lat: 37.3445,
          lng: -121.8702,
          locationLabel: 'near N 13th St & E Julian St',
          createdAt: 4,
        }),
      },
    },

    {
      id: 'fire-t6-road-closed',
      at: 6,
      event: {
        type: 'ROAD_CLOSED',
        closure: {
          id: 'fire-closure-1',
          centerLat: 37.332,
          centerLng: -121.8965,
          radiusMiles: 0.25,
          label: 'fire engines staging on W San Carlos St',
        },
      },
    },
  ];
}

/**
 * Guadalupe River overflows downtown: the river crossing closes immediately, Grocery E
 * loses power and its bottled water, Food Bank B's cooler shorts out, and families move to Shelter C.
 */
export function simulateFlood(options: ScenarioOptions = {}): ScheduledEvent[] {
  return [
    {
      id: 'flood-t0-disaster',
      at: 0,
      event: {
        type: 'DISASTER_STARTED',
        disasterType: 'flood',
        magnitude: 4.2,
        label: 'Guadalupe River flooding — 4.2 in of rain in 6 hours',
      },
    },
    {
      id: 'flood-t0-river-closed',
      at: 0,
      event: {
        type: 'ROAD_CLOSED',
        closure: {
          id: 'flood-closure-1',
          centerLat: 37.3335,
          centerLng: -121.8985,
          radiusMiles: 0.3,
          label: 'Guadalupe River over the road at W San Carlos St',
        },
      },
    },
    { id: 'flood-t0-power-grocery-e', at: 0, event: { type: 'POWER_LOST', facilityId: 'grocery-e' } },
    {
      id: 'flood-t0-stock-grocery-e',
      at: 0,
      event: { type: 'INVENTORY_CHANGED', facilityId: 'grocery-e', itemKind: 'water', delta: -350, reason: 'Contaminated by floodwater' },
    },

    // T+2 — water reaches Food Bank B's compressor; displaced families arrive at Shelter C.
    // Kept small so the resupply still fits in one free volunteer's vehicle.
    { id: 'flood-t2-fridge-food-bank-b', at: 2, event: { type: 'REFRIGERATION_FAILED', facilityId: 'food-bank-b' } },
    { id: 'flood-t2-demand-shelter-c', at: 2, event: { type: 'DEMAND_INCREASED', facilityId: 'shelter-c', additionalPeople: 15 } },

    {
      id: 'flood-t4-request-water',
      at: 4,
      event: {
        type: 'REQUEST_SUBMITTED',
        request: scriptedRequest({
          text: FLOOD_REQUEST_TEXT,
          bedrockParse: options.bedrockParse,
          lat: 37.3268,
          lng: -121.8935,
          locationLabel: 'near Almaden Ave & W Virginia St',
          createdAt: 4,
        }),
      },
    },

    {
      id: 'flood-t6-road-closed',
      at: 6,
      event: {
        type: 'ROAD_CLOSED',
        closure: {
          id: 'flood-closure-2',
          centerLat: 37.326,
          centerLng: -121.889,
          radiusMiles: 0.2,
          label: 'flooded underpass on Almaden Blvd',
        },
      },
    },
  ];
}

/**
 * Extreme heat: rolling blackouts hit Pharmacy A, Shelter C opens as a cooling centre,
 * Food Bank B's compressor overheats, and buckled pavement closes a road.
 */
export function simulateHeatwave(options: ScenarioOptions = {}): ScheduledEvent[] {
  return [
    {
      id: 'heat-t0-disaster',
      at: 0,
      event: {
        type: 'DISASTER_STARTED',
        disasterType: 'heatwave',
        magnitude: 112,
        label: 'Extreme heat — 112 °F with rolling blackouts',
      },
    },
    { id: 'heat-t0-blackout-pharmacy-a', at: 0, event: { type: 'POWER_LOST', facilityId: 'pharmacy-a' } },
    { id: 'heat-t0-cooling-shelter-c', at: 0, event: { type: 'DEMAND_INCREASED', facilityId: 'shelter-c', additionalPeople: 30 } },

    { id: 'heat-t2-fridge-food-bank-b', at: 2, event: { type: 'REFRIGERATION_FAILED', facilityId: 'food-bank-b' } },

    // T+3 — Shelter C goes through its water faster than its consumption rate assumes.
    {
      id: 'heat-t3-water-shelter-c',
      at: 3,
      event: { type: 'INVENTORY_CHANGED', facilityId: 'shelter-c', itemKind: 'water', delta: -50, reason: 'Handed out at cooling centre' },
    },

    {
      id: 'heat-t4-request-water',
      at: 4,
      event: {
        type: 'REQUEST_SUBMITTED',
        request: scriptedRequest({
          text: HEATWAVE_REQUEST_TEXT,
          bedrockParse: options.bedrockParse,
          lat: 37.3299,
          lng: -121.8728,
          locationLabel: 'near S 11th St & E William St',
          createdAt: 4,
        }),
      },
    },

    {
      id: 'heat-t6-road-closed',
      at: 6,
      event: {
        type: 'ROAD_CLOSED',
        closure: {
          id: 'heat-closure-1',
          centerLat: 37.3355,
          centerLng: -121.879,
          radiusMiles: 0.2,
          label: 'buckled pavement on E San Fernando St',
        },
      },
    },
  ];
}

/**
 * Substation fire takes the whole grid down: every facility loses power at once, so
 * only sites with generators keep running. Dead traffic signals close an intersection.
 */
export function simulateGridFailure(options: ScenarioOptions = {}): ScheduledEvent[] {
  const facilities = ['pharmacy-a', 'food-bank-b', 'shelter-c', 'community-center-d', 'grocery-e'];
  return [
    {
      id: 'grid-t0-disaster',
      at: 0,
      event: {
        type: 'DISASTER_STARTED',
        disasterType: 'grid_failure',
        magnitude: 92,
        label: 'Regional grid failure — substation fire, 92% of customers without power',
      },
    },
    ...facilities.map(
      (facilityId): ScheduledEvent => ({ id: `grid-t0-power-${facilityId}`, at: 0, event: { type: 'POWER_LOST', facilityId } }),
    ),

    // T+3 — residents leave dark apartments for Shelter C.
    { id: 'grid-t3-demand-shelter-c', at: 3, event: { type: 'DEMAND_INCREASED', facilityId: 'shelter-c', additionalPeople: 40 } },

    {
      id: 'grid-t4-request-blankets',
      at: 4,
      event: {
        type: 'REQUEST_SUBMITTED',
        request: scriptedRequest({
          text: GRID_FAILURE_REQUEST_TEXT,
          bedrockParse: options.bedrockParse,
          lat: 37.3471,
          lng: -121.8838,
          locationLabel: 'near N 3rd St & E Empire St',
          createdAt: 4,
        }),
      },
    },

    {
      id: 'grid-t6-road-closed',
      at: 6,
      event: {
        type: 'ROAD_CLOSED',
        closure: {
          id: 'grid-closure-1',
          centerLat: 37.3345,
          centerLng: -121.877,
          radiusMiles: 0.2,
          label: 'traffic signals out at E Santa Clara St & 7th St',
        },
      },
    },
  ];
}

export const DISASTER_SCENARIOS: readonly ScenarioDefinition[] = [
  {
    id: 'earthquake',
    name: 'Earthquake',
    summary: 'M7.0 quake knocks out power and refrigeration downtown; debris closes a road.',
    build: simulateEarthquake,
  },
  {
    id: 'wildfire',
    name: 'Wildfire',
    summary: 'Evacuees flood Shelter C, a safety power shutoff hits Pharmacy A, fire crews close a road.',
    build: simulateWildfire,
  },
  {
    id: 'flood',
    name: 'Flood',
    summary: 'Guadalupe River overflows: river crossing closed, Grocery E water ruined, Food Bank B cooler fails.',
    build: simulateFlood,
  },
  {
    id: 'heatwave',
    name: 'Heatwave',
    summary: '112 °F with rolling blackouts: Pharmacy A loses power, Shelter C becomes a cooling centre.',
    build: simulateHeatwave,
  },
  {
    id: 'grid_failure',
    name: 'Grid Blackout',
    summary: 'Substation fire takes out power everywhere; only generator sites keep running.',
    build: simulateGridFailure,
  },
];

export function isDisasterType(value: unknown): value is DisasterType {
  return DISASTER_SCENARIOS.some((s) => s.id === value);
}

/** Timeline for a scenario id. Throws on an unknown id. */
export function buildScenario(id: DisasterType, options: ScenarioOptions = {}): ScheduledEvent[] {
  const scenario = DISASTER_SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error(`Unknown disaster scenario: ${String(id)}`);
  return scenario.build(options);
}
