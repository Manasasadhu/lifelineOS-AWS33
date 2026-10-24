import { describe, expect, it } from 'vitest';
import { DETOUR_FACTOR, haversineMiles, planTrip, routeLeg, ROAD_FACTOR, segmentCrossesClosure } from '../routing';
import type { RoadClosure } from '../types';

const SJSU = { lat: 37.3352, lng: -121.8811 };
const NORTH = { lat: 37.3497, lng: -121.8811 }; // ~1 mile north

describe('routing', () => {
  it('haversine ≈ 1 mile for 0.0145° of latitude', () => {
    expect(haversineMiles(SJSU, NORTH)).toBeCloseTo(1.0, 1);
  });

  it('applies the road factor and 18 mph car speed', () => {
    const leg = routeLeg(SJSU, NORTH, []);
    const expectedMiles = haversineMiles(SJSU, NORTH) * ROAD_FACTOR;
    expect(leg.distanceMiles).toBeCloseTo(expectedMiles, 9);
    expect(leg.etaMinutes).toBeCloseTo((expectedMiles / 18) * 60, 9);
    expect(leg.rerouted).toBe(false);
  });

  it('detects closures on the segment and applies the detour factor', () => {
    const closure: RoadClosure = {
      id: 'c1',
      centerLat: (SJSU.lat + NORTH.lat) / 2,
      centerLng: SJSU.lng + 0.001,
      radiusMiles: 0.15,
      label: 'Collapsed overpass',
    };
    expect(segmentCrossesClosure(SJSU, NORTH, closure)).toBe(true);
    const leg = routeLeg(SJSU, NORTH, [closure]);
    expect(leg.rerouted).toBe(true);
    expect(leg.closureIds).toEqual(['c1']);
    expect(leg.distanceMiles).toBeCloseTo(leg.baseDistanceMiles * DETOUR_FACTOR, 9);
  });

  it('ignores closures away from the segment', () => {
    const far: RoadClosure = { id: 'c2', centerLat: SJSU.lat, centerLng: -121.86, radiusMiles: 0.2, label: 'Far' };
    expect(segmentCrossesClosure(SJSU, NORTH, far)).toBe(false);
  });

  it('plans volunteer → source → destination and sums legs', () => {
    const trip = planTrip({ ...SJSU, vehicle: 'bike' }, NORTH, SJSU, []);
    expect(trip.distanceMiles).toBeCloseTo(trip.toSource.distanceMiles + trip.toDestination.distanceMiles, 9);
    // Bike is slower than a car.
    expect(trip.toSource.etaMinutes).toBeGreaterThan(routeLeg(SJSU, NORTH, [], 'car').etaMinutes);
  });
});
