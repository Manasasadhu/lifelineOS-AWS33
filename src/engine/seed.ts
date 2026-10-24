/**
 * Mock community network around downtown San José / SJSU (≈ 37.3352, -121.8811).
 * All names are generic and all numbers are invented for the demo.
 * Every location is within ~2 miles of SJSU.
 */
import { deriveState } from './engine';
import type { EngineState, Facility, Volunteer } from './types';

export const SJSU_CENTER = { lat: 37.3352, lng: -121.8811 } as const;

const SEED_FACILITIES: Facility[] = [
  {
    id: 'pharmacy-a',
    name: 'Pharmacy A',
    type: 'pharmacy',
    lat: 37.3387,
    lng: -121.8853,
    hasPower: true,
    powerSource: 'grid',
    // No backup: refrigeration fails as soon as the grid drops.
    refrigeration: {
      working: true,
      currentTempC: 3.4,
      maxSafeTempC: 8,
      // (8 - 3.4) °C / 6 °C per hour = 46 minutes to failure once cooling stops.
      tempRiseRateCPerHour: 6,
      spareCapacityUnits: 20,
    },
    inventory: [
      { id: 'pharmacy-a-insulin', kind: 'insulin', quantity: 25, unit: 'doses', requiresColdStorage: true },
      { id: 'pharmacy-a-medication', kind: 'medication', quantity: 12, unit: 'vials', requiresColdStorage: true },
    ],
    peopleServed: 60,
    status: 'stable',
  },
  {
    id: 'food-bank-b',
    name: 'Food Bank B',
    type: 'food_bank',
    lat: 37.323,
    lng: -121.877,
    hasPower: true,
    powerSource: 'grid',
    // Generator keeps the lights on, but the cooler compressor fails at T+2 in the scenario.
    backupSource: 'generator',
    batteryHoursRemaining: 6,
    refrigeration: {
      working: true,
      currentTempC: 2,
      maxSafeTempC: 5,
      // (5 - 2) °C / 2 °C per hour = 90 minutes to failure once cooling stops.
      tempRiseRateCPerHour: 2,
      spareCapacityUnits: 0,
    },
    inventory: [
      { id: 'food-bank-b-meals', kind: 'meals', quantity: 243, unit: 'meals', requiresColdStorage: true },
      { id: 'food-bank-b-water', kind: 'water', quantity: 500, unit: 'bottles', requiresColdStorage: false },
    ],
    peopleServed: 0,
    status: 'stable',
  },
  {
    id: 'shelter-c',
    name: 'Shelter C',
    type: 'shelter',
    lat: 37.348,
    lng: -121.895,
    hasPower: true,
    powerSource: 'grid',
    refrigeration: null,
    inventory: [
      // 25 meals at 5 meals/hour = 5 hours of supply for 40 people.
      { id: 'shelter-c-meals', kind: 'meals', quantity: 25, unit: 'meals', requiresColdStorage: false, consumptionPerHour: 5 },
      { id: 'shelter-c-water', kind: 'water', quantity: 80, unit: 'bottles', requiresColdStorage: false, consumptionPerHour: 4 },
      { id: 'shelter-c-blankets', kind: 'blankets', quantity: 30, unit: 'blankets', requiresColdStorage: false },
    ],
    peopleServed: 40,
    status: 'stable',
  },
  {
    id: 'community-center-d',
    name: 'Community Center D',
    type: 'community_center',
    lat: 37.3305,
    lng: -121.865,
    hasPower: true,
    powerSource: 'grid',
    backupSource: 'generator',
    batteryHoursRemaining: 17,
    refrigeration: {
      working: true,
      currentTempC: 3,
      maxSafeTempC: 8,
      tempRiseRateCPerHour: 4,
      spareCapacityUnits: 300,
    },
    inventory: [
      { id: 'community-center-d-water', kind: 'water', quantity: 200, unit: 'bottles', requiresColdStorage: false },
      { id: 'community-center-d-blankets', kind: 'blankets', quantity: 60, unit: 'blankets', requiresColdStorage: false },
    ],
    peopleServed: 120,
    status: 'stable',
  },
  {
    id: 'grocery-e',
    name: 'Grocery Store E',
    type: 'grocery',
    lat: 37.315,
    lng: -121.899,
    hasPower: true,
    powerSource: 'grid',
    refrigeration: null,
    inventory: [
      { id: 'grocery-e-meals', kind: 'meals', quantity: 370, unit: 'meals', requiresColdStorage: false },
      { id: 'grocery-e-water', kind: 'water', quantity: 600, unit: 'bottles', requiresColdStorage: false },
    ],
    peopleServed: 0,
    status: 'stable',
  },
];

const SEED_VOLUNTEERS: Volunteer[] = [
  { id: 'vol-01', name: 'Volunteer #01', lat: 37.342, lng: -121.89, vehicle: 'car', capacity: 80, hasCooler: false, available: true },
  { id: 'vol-02', name: 'Volunteer #02', lat: 37.32, lng: -121.885, vehicle: 'van', capacity: 300, hasCooler: true, available: true },
  { id: 'vol-03', name: 'Volunteer #03', lat: 37.336, lng: -121.88, vehicle: 'bike', capacity: 20, hasCooler: false, available: true },
  { id: 'vol-04', name: 'Volunteer #04', lat: 37.333, lng: -121.87, vehicle: 'car', capacity: 60, hasCooler: true, available: true },
  { id: 'vol-05', name: 'Volunteer #05', lat: 37.35, lng: -121.875, vehicle: 'van', capacity: 400, hasCooler: false, available: true },
];

/** Fresh, deep-cloned initial state. Safe to mutate the result. */
export function createInitialState(): EngineState {
  return deriveState({
    simTime: 0,
    disaster: null,
    facilities: structuredClone(SEED_FACILITIES),
    volunteers: structuredClone(SEED_VOLUNTEERS),
    requests: [],
    roadClosures: [],
    actions: [],
    clocks: [],
    lostInventory: [],
    connection: 'online',
    pendingSyncCount: 0,
    eventLog: [],
  });
}
