import { Facility, RouteEstimate, WorldState } from "../types";

const EARTH_MI = 3958.8;

export function haversineMiles(a: Facility, b: Facility): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Average urban speed; closed 4th St corridor adds a detour. */
export function estimateRoute(state: WorldState, from: Facility, to: Facility): RouteEstimate {
  let distanceMiles = Number(haversineMiles(from, to).toFixed(1));
  let etaMinutes = Math.max(4, Math.round((distanceMiles / 18) * 60));
  let detour = false;

  const blockedPair =
    state.incident.roadClosed &&
    ((from.id === "pharmacy-a" && to.id === "community-center-d") ||
      (from.id === "community-center-d" && to.id === "pharmacy-a") ||
      (from.id === "grocery-e" && to.id === "shelter-c"));

  if (blockedPair) {
    detour = true;
    distanceMiles = Number((distanceMiles * 1.45 + 0.8).toFixed(1));
    etaMinutes = Math.round(etaMinutes * 1.5 + 4);
  }

  return { distanceMiles, etaMinutes, detour };
}

export function findById(state: WorldState, id: string): Facility | undefined {
  return state.facilities.find((f) => f.id === id);
}
