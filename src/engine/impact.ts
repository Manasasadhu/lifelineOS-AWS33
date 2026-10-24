/**
 * Impact metrics. SIMULATION RESULTS ONLY — derived exclusively from completed
 * actions and lost inventory in the simulated scenario, using mock data.
 */
import { routeLeg } from './routing';
import { SJSU_CENTER } from './seed';
import type { Action, EngineState, ItemKind } from './types';

export const IMPACT_LABEL = 'SIMULATION RESULTS';

/** Assumed average response time for manual (phone/radio) dispatch. A fixed assumption, not a measurement. */
export const BASELINE_MANUAL_RESPONSE_MINUTES = 21;

/** Naive baseline: every trip starts and ends at one central depot (SJSU). */
export const BASELINE_DEPOT = SJSU_CENTER;

export interface ImpactMetrics {
  label: typeof IMPACT_LABEL;
  simTime: number;
  completedActions: number;
  /** Meals moved out of failing cold storage before they spoiled. */
  mealsRescued: number;
  /** Meals delivered to shelters / residents. */
  mealsDelivered: number;
  /** Insulin + cold medication moved out of failing cold storage. */
  dosesProtected: number;
  /** People served by completed actions, counted once per need. */
  residentsAssisted: number;
  requestsResolved: number;
  /** Response = need first known → volunteer dispatched (approved). Averaged over completed actions. */
  avgResponseMinutes: number | null;
  /** Assumed manual-dispatch response time, for comparison with avgResponseMinutes. */
  baselineResponseMinutes: number;
  /** Positive = faster than baseline. null if no completed actions. */
  responseMinutesSaved: number | null;
  /** Need first known → help delivered (completed). */
  avgDeliveryMinutes: number | null;
  actualMiles: number;
  baselineMiles: number;
  milesAvoided: number;
  unitsLost: number;
  lostByKind: Partial<Record<ItemKind, number>>;
  /** Rescued / (rescued + lost) for cold-storage resources, 0–100. null if nothing was ever at risk. */
  criticalPreservedPercent: number | null;
  assumptions: string[];
}

const MEDICAL: ReadonlySet<ItemKind> = new Set(['insulin', 'medication']);

type NeedClass = 'rescue' | 'resupply' | 'request';

/** Follow reassignment chains back to the original need. */
function rootNeedId(action: Action, byId: Map<string, Action>): string {
  let a = action;
  for (let guard = 0; a.needId.startsWith('reassign:') && guard < 10; guard++) {
    const original = byId.get(a.needId.slice('reassign:'.length));
    if (!original) break;
    a = original;
  }
  return a.needId;
}

function classify(needId: string, state: EngineState): NeedClass {
  if (needId.endsWith(':supply')) return 'resupply';
  if (state.requests.some((r) => r.id === needId)) return 'request';
  return 'rescue';
}

function baselineMilesFor(action: Action, state: EngineState): number | null {
  const source = state.facilities.find((f) => f.id === action.fromFacilityId);
  const dest = action.toFacilityId
    ? state.facilities.find((f) => f.id === action.toFacilityId)
    : state.requests.find((r) => r.id === action.toRequestId);
  if (!source || !dest) return null;
  return (
    routeLeg(BASELINE_DEPOT, source, []).distanceMiles +
    routeLeg(source, dest, []).distanceMiles +
    routeLeg(dest, BASELINE_DEPOT, []).distanceMiles
  );
}

export function computeImpact(state: EngineState): ImpactMetrics {
  const byId = new Map(state.actions.map((a) => [a.id, a]));
  const completed = state.actions.filter((a) => a.status === 'completed');

  let mealsRescued = 0;
  let mealsDelivered = 0;
  let dosesProtected = 0;
  let actualMiles = 0;
  let baselineMiles = 0;
  let responseTotal = 0;
  let deliveryTotal = 0;
  const peopleByNeed = new Map<string, number>();

  for (const a of completed) {
    const needId = rootNeedId(a, byId);
    const kind = classify(needId, state);

    if (kind === 'rescue') {
      if (a.itemKind === 'meals') mealsRescued += a.quantity;
      if (MEDICAL.has(a.itemKind)) dosesProtected += a.quantity;
    } else if (a.itemKind === 'meals') {
      mealsDelivered += a.quantity;
    }

    peopleByNeed.set(needId, Math.max(peopleByNeed.get(needId) ?? 0, a.impact.peopleHelped));

    actualMiles += a.distanceMiles;
    baselineMiles += baselineMilesFor(a, state) ?? a.distanceMiles;

    const request = a.toRequestId ? state.requests.find((r) => r.id === a.toRequestId) : undefined;
    const knownAt = request?.createdAt ?? a.createdAt;
    responseTotal += (a.approvedAt ?? knownAt) - knownAt;
    deliveryTotal += (a.completedAt ?? state.simTime) - knownAt;
  }

  const lostByKind: Partial<Record<ItemKind, number>> = {};
  let unitsLost = 0;
  for (const l of state.lostInventory) {
    lostByKind[l.kind] = (lostByKind[l.kind] ?? 0) + l.quantity;
    unitsLost += l.quantity;
  }
  // Lost inventory only ever comes from failed cold storage.
  const rescued = mealsRescued + dosesProtected;
  const atRisk = rescued + unitsLost;

  const avgResponseMinutes = completed.length ? responseTotal / completed.length : null;

  return {
    label: IMPACT_LABEL,
    simTime: state.simTime,
    completedActions: completed.length,
    mealsRescued,
    mealsDelivered,
    dosesProtected,
    residentsAssisted: [...peopleByNeed.values()].reduce((n, p) => n + p, 0),
    requestsResolved: state.requests.filter((r) => r.status === 'resolved').length,
    avgResponseMinutes,
    baselineResponseMinutes: BASELINE_MANUAL_RESPONSE_MINUTES,
    responseMinutesSaved: avgResponseMinutes === null ? null : BASELINE_MANUAL_RESPONSE_MINUTES - avgResponseMinutes,
    avgDeliveryMinutes: completed.length ? deliveryTotal / completed.length : null,
    actualMiles,
    baselineMiles,
    milesAvoided: baselineMiles - actualMiles,
    unitsLost,
    lostByKind,
    criticalPreservedPercent: atRisk > 0 ? (rescued / atRisk) * 100 : null,
    assumptions: [
      'Simulation with mock data around downtown San José; not real-world results.',
      `Response time = need known → volunteer dispatched. Baseline is a fixed ${BASELINE_MANUAL_RESPONSE_MINUTES}-minute manual-dispatch assumption, not a measurement.`,
      'In the CLI run the top proposal is auto-approved instantly; human approval adds real time.',
      'Baseline miles: every trip starts and ends at a single central depot (SJSU), no road closures.',
      'Residents assisted counts each need once; meals assume 3 per person per day.',
      'Critical resources = cold-storage stock (insulin, medication, refrigerated meals).',
    ],
  };
}
