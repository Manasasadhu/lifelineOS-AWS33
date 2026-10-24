/**
 * Explainable priority scoring and feasibility rules.
 *
 *   score = (urgencyWeight × log2(1 + peopleAffected) × vulnerabilityMultiplier
 *            × timePressure × resourceCriticality)
 *           / (1 + distanceMiles + detourPenalty)
 *
 * EQUITY RULE: the score never considers who asked first, organization size,
 * ability to pay, or any identity attribute. Only need, vulnerability, time
 * pressure, resource criticality and distance are allowed inputs.
 */
import type { ItemKind, PriorityBreakdown, Urgency, Volunteer } from './types';
import type { TripPlan } from './routing';

export const URGENCY_WEIGHT: Record<Urgency, number> = {
  critical: 10,
  high: 6,
  medium: 3,
  low: 1,
};

export const RESOURCE_CRITICALITY: Record<ItemKind, number> = {
  insulin: 3,
  medication: 3,
  meals: 1.5,
  water: 2,
  blankets: 1,
};

export const VULNERABLE_MULTIPLIER = 1.5;
export const MIN_TIME_PRESSURE_MINUTES = 5;
export const LOADING_BUFFER_MINUTES = 5;
/** Cold items may ride without a cooler only if the loaded leg is shorter than this. */
export const MAX_UNCOOLED_TRIP_MINUTES = 20;

export interface PriorityInput {
  urgency: Urgency;
  peopleAffected: number;
  vulnerable: boolean;
  minutesRemaining: number;
  itemKind: ItemKind;
  /** Base (undetoured) trip distance. */
  distanceMiles: number;
  /** Extra miles added by detours around road closures. */
  detourPenalty: number;
}

export function scorePriority(input: PriorityInput): { score: number; breakdown: PriorityBreakdown } {
  const urgencyWeight = URGENCY_WEIGHT[input.urgency];
  const peopleFactor = Math.log2(1 + Math.max(0, input.peopleAffected));
  const vulnerabilityMultiplier = input.vulnerable ? VULNERABLE_MULTIPLIER : 1;
  const timePressure = 60 / Math.max(input.minutesRemaining, MIN_TIME_PRESSURE_MINUTES);
  const resourceCriticality = RESOURCE_CRITICALITY[input.itemKind];
  const numerator = urgencyWeight * peopleFactor * vulnerabilityMultiplier * timePressure * resourceCriticality;
  const denominator = 1 + input.distanceMiles + input.detourPenalty;
  return {
    score: numerator / denominator,
    breakdown: {
      urgency: input.urgency,
      urgencyWeight,
      peopleAffected: input.peopleAffected,
      peopleFactor,
      vulnerable: input.vulnerable,
      vulnerabilityMultiplier,
      minutesRemaining: input.minutesRemaining,
      timePressure,
      itemKind: input.itemKind,
      resourceCriticality,
      distanceMiles: input.distanceMiles,
      detourPenalty: input.detourPenalty,
      numerator,
      denominator,
    },
  };
}

export interface FeasibilityInput {
  trip: TripPlan;
  volunteer: Volunteer;
  quantity: number;
  minutesRemaining: number;
  requiresColdStorage: boolean;
}

/** Returns null if feasible, otherwise a human-readable reason. */
export function infeasibilityReason(input: FeasibilityInput): string | null {
  const { trip, volunteer, quantity, minutesRemaining, requiresColdStorage } = input;
  if (!volunteer.available) return `${volunteer.name} is busy`;
  if (volunteer.capacity < quantity) {
    return `${volunteer.name} can carry ${volunteer.capacity}, needs ${quantity}`;
  }
  const arrival = trip.etaMinutes + LOADING_BUFFER_MINUTES;
  if (arrival >= minutesRemaining) {
    return `${volunteer.name} arrives in ${Math.ceil(arrival)} min (incl. ${LOADING_BUFFER_MINUTES} min loading), but failure is in ${Math.floor(minutesRemaining)} min`;
  }
  if (requiresColdStorage && !volunteer.hasCooler && trip.toDestination.etaMinutes >= MAX_UNCOOLED_TRIP_MINUTES) {
    return `${volunteer.name} has no cooler and the cold leg takes ${Math.ceil(trip.toDestination.etaMinutes)} min (max ${MAX_UNCOOLED_TRIP_MINUTES})`;
  }
  return null;
}
