/**
 * Simple, explainable routing. No external APIs:
 *   road distance = great-circle distance × ROAD_FACTOR
 *   detour        = × DETOUR_FACTOR if the straight segment crosses a closure circle
 *   ETA           = distance / vehicle speed
 */
import type { RoadClosure, VehicleType } from './types';

export const ROAD_FACTOR = 1.3;
export const DETOUR_FACTOR = 1.6;
export const EARTH_RADIUS_MILES = 3958.8;

/** Average urban speeds in mph. Tunable. */
export const VEHICLE_SPEED_MPH: Record<VehicleType, number> = {
  car: 18,
  van: 18,
  bike: 10,
};

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteLeg {
  distanceMiles: number;
  /** Distance the leg would have been without any detour. */
  baseDistanceMiles: number;
  etaMinutes: number;
  rerouted: boolean;
  closureIds: string[];
}

export interface TripPlan {
  /** Volunteer → pickup. */
  toSource: RouteLeg;
  /** Pickup → drop-off. Items are in transit only during this leg. */
  toDestination: RouteLeg;
  distanceMiles: number;
  baseDistanceMiles: number;
  /** Extra miles added by detours. */
  detourMiles: number;
  etaMinutes: number;
  rerouted: boolean;
  closureIds: string[];
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineMiles(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True if the straight segment a→b passes within the closure's radius. */
export function segmentCrossesClosure(a: LatLng, b: LatLng, closure: RoadClosure): boolean {
  // Local flat projection in miles, centred on the closure. Accurate at city scale.
  const milesPerDegLat = (Math.PI / 180) * EARTH_RADIUS_MILES;
  const milesPerDegLng = milesPerDegLat * Math.cos(toRad(closure.centerLat));
  const project = (p: LatLng) => ({
    x: (p.lng - closure.centerLng) * milesPerDegLng,
    y: (p.lat - closure.centerLat) * milesPerDegLat,
  });
  const p = project(a);
  const q = project(b);
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, -(p.x * dx + p.y * dy) / lenSq));
  const cx = p.x + t * dx;
  const cy = p.y + t * dy;
  return Math.hypot(cx, cy) <= closure.radiusMiles;
}

export function routeLeg(
  from: LatLng,
  to: LatLng,
  closures: readonly RoadClosure[],
  vehicle: VehicleType = 'car',
): RouteLeg {
  const baseDistanceMiles = haversineMiles(from, to) * ROAD_FACTOR;
  const closureIds = closures.filter((c) => segmentCrossesClosure(from, to, c)).map((c) => c.id);
  const rerouted = closureIds.length > 0;
  const distanceMiles = rerouted ? baseDistanceMiles * DETOUR_FACTOR : baseDistanceMiles;
  return {
    distanceMiles,
    baseDistanceMiles,
    etaMinutes: (distanceMiles / VEHICLE_SPEED_MPH[vehicle]) * 60,
    rerouted,
    closureIds,
  };
}

/** Volunteer → source → destination. */
export function planTrip(
  volunteer: LatLng & { vehicle: VehicleType },
  source: LatLng,
  destination: LatLng,
  closures: readonly RoadClosure[],
): TripPlan {
  const toSource = routeLeg(volunteer, source, closures, volunteer.vehicle);
  const toDestination = routeLeg(source, destination, closures, volunteer.vehicle);
  const distanceMiles = toSource.distanceMiles + toDestination.distanceMiles;
  const baseDistanceMiles = toSource.baseDistanceMiles + toDestination.baseDistanceMiles;
  return {
    toSource,
    toDestination,
    distanceMiles,
    baseDistanceMiles,
    detourMiles: distanceMiles - baseDistanceMiles,
    etaMinutes: toSource.etaMinutes + toDestination.etaMinutes,
    rerouted: toSource.rerouted || toDestination.rerouted,
    closureIds: [...new Set([...toSource.closureIds, ...toDestination.closureIds])],
  };
}
