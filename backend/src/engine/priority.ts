import { Facility, Urgency } from "../types";
import { remainingHours } from "./clocks";

const URGENCY_WEIGHT: Record<Urgency, number> = {
  critical: 5,
  high: 3.5,
  medium: 2,
  low: 1,
};

/**
 * Priority =
 *   urgency × people × vulnerability × time-to-failure × equity
 *   / (distance + transportation difficulty)
 *
 * Higher is better. Explainable for the pitch — not a research model.
 */
export function priorityScore(input: {
  urgency: Urgency;
  peopleAffected: number;
  source: Facility;
  destination: Facility;
  distanceMiles: number;
  roadClosed: boolean;
  equityBoost?: number;
}): number {
  const ttfHours = remainingHours(input.source) ?? 24;
  const timePressure = 24 / Math.max(0.15, ttfHours);
  const vulnerability = input.source.inventory.some((i) => i.coldChain) ? 1.8 : 1.2;
  const equity = input.equityBoost ?? (input.source.peopleServed > 100 ? 1.15 : 1);
  const transport = input.distanceMiles + (input.roadClosed ? 3 : 0.5);
  const people = Math.max(1, input.peopleAffected);

  return (
    (URGENCY_WEIGHT[input.urgency] * people * vulnerability * timePressure * equity) / transport
  );
}
