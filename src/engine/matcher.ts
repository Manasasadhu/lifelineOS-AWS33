/**
 * Need ↔ resource ↔ volunteer matching.
 *
 * Four kinds of need:
 *  - rescue:   cold stock that is warming → move it to a facility with working, powered cold storage.
 *  - resupply: a consumed stock (shelter meals) running low → bring stock from another facility.
 *  - request:  an open resident/facility request → deliver from a facility with stock.
 *  - reassign: an in-progress action that will now miss its deadline → same trip, different volunteer.
 *
 * Greedy, highest score first: each round picks the single best (need, source,
 * destination, volunteer) candidate, books the volunteer and inventory, then
 * re-scores what is left. No volunteer or unit of inventory is double-booked.
 */
import { backupMinutesRemaining, coldStorageMinutesRemaining, ITEM_LABELS, isCooling, severityFor } from './clocks';
import { infeasibilityReason, LOADING_BUFFER_MINUTES, scorePriority } from './priority';
import { planTrip, type LatLng, type TripPlan } from './routing';
import type {
  Action,
  ClockSeverity,
  EngineState,
  Facility,
  ItemKind,
  PriorityBreakdown,
  RejectedOption,
  RoadClosure,
  Urgency,
  Volunteer,
} from './types';

export const ALTERNATIVES_PER_ACTION = 2;
export const MAX_REJECTED_PER_ACTION = 10;
/** A destination's own cold storage must outlast this to accept rescued cold items. */
export const SAFE_COLD_DESTINATION_MINUTES = 480;
/** Resupply tops a shelter up to this many hours of consumption. */
export const RESUPPLY_HORIZON_HOURS = 12;
/** Smallest resupply worth a trip. */
export const MIN_RESUPPLY_UNITS = 10;
/** Time budget for requests, which have no physical clock. */
export const REQUEST_DEADLINE_MINUTES: Record<Urgency, number> = {
  critical: 60,
  high: 120,
  medium: 240,
  low: 480,
};
/** People who depend on one unit of stock (for scoring rescues). */
export const PEOPLE_PER_UNIT: Record<ItemKind, number> = {
  insulin: 1,
  medication: 1,
  meals: 1 / 3,
  water: 1 / 3,
  blankets: 1,
};

const URGENCY_FROM_SEVERITY: Record<ClockSeverity, Urgency> = {
  critical: 'critical',
  at_risk: 'high',
  warning: 'medium',
  stable: 'low',
};

const MEDICAL: ReadonlySet<ItemKind> = new Set(['insulin', 'medication']);

export type MatchNeedKind = 'rescue' | 'resupply' | 'request' | 'reassign';

export interface MatchNeed {
  /** Clock resourceId (rescue/resupply), request id, or `reassign:<actionId>`. */
  id: string;
  kind: MatchNeedKind;
  itemKind: ItemKind;
  unit: string;
  quantity: number;
  requiresColdStorage: boolean;
  minutesRemaining: number;
  urgency: Urgency;
  peopleAffected: number;
  vulnerable: boolean;
  sourceFacilityId?: string;
  destFacilityId?: string;
  destRequestId?: string;
  /** For reassign: the at-risk action being replaced. */
  replacesActionId?: string;
}

interface Destination extends LatLng {
  kind: 'facility' | 'request';
  id: string;
  name: string;
}

interface Route {
  source: Facility;
  destination: Destination;
  quantity: number;
}

interface Candidate extends Route {
  need: MatchNeed;
  volunteer: Volunteer;
  trip: TripPlan;
  score: number;
  breakdown: PriorityBreakdown;
}

export interface UnmetNeed {
  need: MatchNeed;
  rejected: RejectedOption[];
}

export interface MatchResult {
  actions: Action[];
  unmet: UnmetNeed[];
}

/** Inventory / capacity already promised to actions or to earlier picks in this round. */
interface Ledger {
  outgoing: Map<string, number>; // `${facilityId}:${kind}` → units leaving
  incoming: Map<string, number>; // `${facilityId}:${kind}` → units arriving
  coldIncoming: Map<string, number>; // facilityId → cold units arriving
  bookedVolunteers: Set<string>;
  declinedIds: Set<string>;
}

const key = (facilityId: string, kind: ItemKind) => `${facilityId}:${kind}`;
const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);

export function isActiveAction(a: Action): boolean {
  return a.status === 'approved' || a.status === 'in_progress';
}

function ledgerFromActions(state: EngineState): Ledger {
  const ledger: Ledger = {
    outgoing: new Map(),
    incoming: new Map(),
    coldIncoming: new Map(),
    bookedVolunteers: new Set(),
    declinedIds: new Set(),
  };
  for (const a of state.actions) {
    if (a.status === 'declined') ledger.declinedIds.add(a.id);
    if (!isActiveAction(a)) continue;
    add(ledger.outgoing, key(a.fromFacilityId, a.itemKind), a.quantity);
    if (a.toFacilityId) {
      add(ledger.incoming, key(a.toFacilityId, a.itemKind), a.quantity);
      const item = state.facilities
        .find((f) => f.id === a.fromFacilityId)
        ?.inventory.find((i) => i.kind === a.itemKind);
      if (item?.requiresColdStorage) add(ledger.coldIncoming, a.toFacilityId, a.quantity);
    }
    ledger.bookedVolunteers.add(a.volunteerId);
  }
  return ledger;
}

function available(f: Facility, kind: ItemKind, ledger: Ledger): number {
  const item = f.inventory.find((i) => i.kind === kind);
  if (!item) return 0;
  return Math.max(0, Math.floor(item.quantity - (ledger.outgoing.get(key(f.id, kind)) ?? 0)));
}

// ---------------------------------------------------------------------------
// Needs
// ---------------------------------------------------------------------------

/** Every open need the matcher would try to serve right now. */
export function collectNeeds(state: EngineState): MatchNeed[] {
  return collectNeedsWith(state, ledgerFromActions(state));
}

function collectNeedsWith(state: EngineState, ledger: Ledger): MatchNeed[] {
  const needs: MatchNeed[] = [];
  const byId = new Map(state.facilities.map((f) => [f.id, f]));

  for (const a of state.actions) {
    if (!isActiveAction(a) || !a.atRisk || a.deadlineAt === undefined) continue;
    const minutesRemaining = Math.max(0, a.deadlineAt - state.simTime);
    needs.push({
      id: `reassign:${a.id}`,
      kind: 'reassign',
      itemKind: a.itemKind,
      unit: unitFor(state, a.itemKind),
      quantity: a.quantity,
      requiresColdStorage: MEDICAL.has(a.itemKind) || a.itemKind === 'meals',
      minutesRemaining,
      urgency: URGENCY_FROM_SEVERITY[severityFor(minutesRemaining)],
      peopleAffected: a.scoreBreakdown.peopleAffected,
      vulnerable: a.scoreBreakdown.vulnerable,
      sourceFacilityId: a.fromFacilityId,
      ...(a.toFacilityId ? { destFacilityId: a.toFacilityId } : {}),
      ...(a.toRequestId ? { destRequestId: a.toRequestId } : {}),
      replacesActionId: a.id,
    });
  }

  for (const clock of state.clocks) {
    const f = byId.get(clock.facilityId);
    if (!f || !clock.itemKind) continue;

    if (clock.kind === 'cold_storage' && !isCooling(f)) {
      const item = f.inventory.find((i) => i.id === clock.resourceId);
      if (!item) continue;
      const qty = available(f, item.kind, ledger);
      if (qty <= 0) continue;
      needs.push({
        id: clock.resourceId,
        kind: 'rescue',
        itemKind: item.kind,
        unit: item.unit,
        quantity: qty,
        requiresColdStorage: true,
        minutesRemaining: clock.minutesRemaining,
        urgency: URGENCY_FROM_SEVERITY[clock.severity],
        peopleAffected: Math.ceil(qty * PEOPLE_PER_UNIT[item.kind]),
        vulnerable: MEDICAL.has(item.kind),
        sourceFacilityId: f.id,
      });
    }

    if (clock.kind === 'supply' && clock.severity !== 'stable') {
      const item = f.inventory.find((i) => `${i.id}:supply` === clock.resourceId);
      if (!item?.consumptionPerHour) continue;
      // One delivery at a time per shelter + item, and no trivial top-ups.
      if ((ledger.incoming.get(key(f.id, item.kind)) ?? 0) > 0) continue;
      const shortfall = Math.ceil(item.consumptionPerHour * RESUPPLY_HORIZON_HOURS - item.quantity);
      if (shortfall < MIN_RESUPPLY_UNITS) continue;
      needs.push({
        id: clock.resourceId,
        kind: 'resupply',
        itemKind: item.kind,
        unit: item.unit,
        quantity: shortfall,
        requiresColdStorage: false,
        minutesRemaining: clock.minutesRemaining,
        urgency: URGENCY_FROM_SEVERITY[clock.severity],
        peopleAffected: f.peopleServed,
        vulnerable: false,
        destFacilityId: f.id,
      });
    }
  }

  for (const r of state.requests) {
    if (r.status !== 'open') continue;
    const elapsed = state.simTime - r.createdAt;
    needs.push({
      id: r.id,
      kind: 'request',
      itemKind: r.needKind,
      unit: unitFor(state, r.needKind),
      quantity: r.quantity,
      requiresColdStorage: MEDICAL.has(r.needKind),
      minutesRemaining: Math.max(0, REQUEST_DEADLINE_MINUTES[r.urgency] - elapsed),
      urgency: r.urgency,
      peopleAffected: r.peopleAffected,
      vulnerable: r.vulnerable,
      destRequestId: r.id,
    });
  }

  return needs;
}

function unitFor(state: EngineState, kind: ItemKind): string {
  for (const f of state.facilities) {
    const item = f.inventory.find((i) => i.kind === kind);
    if (item) return item.unit;
  }
  return kind;
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

function facilityDest(f: Facility): Destination {
  return { kind: 'facility', id: f.id, name: f.name, lat: f.lat, lng: f.lng };
}

export function destinationFor(
  state: EngineState,
  target: { toFacilityId?: string; toRequestId?: string },
): Destination | undefined {
  if (target.toFacilityId) {
    const f = state.facilities.find((x) => x.id === target.toFacilityId);
    return f ? facilityDest(f) : undefined;
  }
  const r = state.requests.find((x) => x.id === target.toRequestId);
  return r ? { kind: 'request', id: r.id, name: r.locationLabel, lat: r.lat, lng: r.lng } : undefined;
}

/** Candidate (source, destination, quantity) combinations for a need, before volunteers. */
function routes(need: MatchNeed, state: EngineState, ledger: Ledger): Route[] {
  const facilities = state.facilities;

  if (need.kind === 'reassign') {
    const source = facilities.find((f) => f.id === need.sourceFacilityId);
    const destination = destinationFor(state, { toFacilityId: need.destFacilityId, toRequestId: need.destRequestId });
    return source && destination ? [{ source, destination, quantity: need.quantity }] : [];
  }

  if (need.kind === 'rescue') {
    const source = facilities.find((f) => f.id === need.sourceFacilityId);
    if (!source) return [];
    return facilities
      .filter((f) => f.id !== source.id && isCooling(f))
      .filter((f) => {
        const mins = coldStorageMinutesRemaining(f);
        return mins === null || mins >= SAFE_COLD_DESTINATION_MINUTES;
      })
      .filter((f) => (f.refrigeration?.spareCapacityUnits ?? 0) - (ledger.coldIncoming.get(f.id) ?? 0) >= need.quantity)
      .map((f) => ({ source, destination: facilityDest(f), quantity: need.quantity }));
  }

  const destination = destinationFor(state, { toFacilityId: need.destFacilityId, toRequestId: need.destRequestId });
  if (!destination) return [];
  const destFacility = facilities.find((f) => f.id === destination.id);

  const out: Route[] = [];
  for (const source of facilities) {
    if (source.id === destination.id) continue;
    const item = source.inventory.find((i) => i.kind === need.itemKind);
    // Never pull from stock that the source is itself consuming (e.g. another shelter).
    if (!item || item.consumptionPerHour) continue;
    // Cold items can only go to a facility that can keep them cold. Homes consume them directly.
    if (item.requiresColdStorage && destFacility && !isCooling(destFacility)) continue;
    const qty = Math.min(need.quantity, available(source, need.itemKind, ledger));
    if (qty <= 0) continue;
    if (need.kind === 'request' && qty < need.quantity) continue;
    out.push({ source, destination, quantity: qty });
  }
  return out;
}

function evaluate(
  need: MatchNeed,
  state: EngineState,
  ledger: Ledger,
): { feasible: Candidate[]; rejected: RejectedOption[] } {
  const feasible: Candidate[] = [];
  const rejected: RejectedOption[] = [];
  const options = routes(need, state, ledger);
  if (options.length === 0) {
    rejected.push({
      destinationId: need.destFacilityId ?? need.destRequestId ?? '',
      reason:
        need.kind === 'rescue'
          ? 'No facility with working, powered cold storage and spare capacity'
          : 'No facility has enough spare stock',
    });
  }

  const volunteers = state.volunteers.filter((v) => v.available && !ledger.bookedVolunteers.has(v.id));
  for (const { source, destination, quantity } of options) {
    const requiresColdStorage =
      source.inventory.find((i) => i.kind === need.itemKind)?.requiresColdStorage ?? need.requiresColdStorage;
    for (const volunteer of volunteers) {
      if (ledger.declinedIds.has(actionId({ need, source, destination, volunteer }))) continue;
      const trip = planTrip(volunteer, source, destination, state.roadClosures);
      const reason = infeasibilityReason({
        trip,
        volunteer,
        quantity,
        minutesRemaining: need.minutesRemaining,
        requiresColdStorage,
      });
      if (reason) {
        rejected.push({ destinationId: destination.id, volunteerId: volunteer.id, reason });
        continue;
      }
      const { score, breakdown } = scorePriority({
        urgency: need.urgency,
        peopleAffected: need.peopleAffected,
        vulnerable: need.vulnerable,
        minutesRemaining: need.minutesRemaining,
        itemKind: need.itemKind,
        distanceMiles: trip.baseDistanceMiles,
        detourPenalty: trip.detourMiles,
      });
      feasible.push({ need, source, destination, volunteer, trip, quantity, score, breakdown });
    }
  }

  feasible.sort(
    (a, b) =>
      b.score - a.score ||
      a.trip.etaMinutes - b.trip.etaMinutes ||
      actionId(a).localeCompare(actionId(b)),
  );
  return { feasible, rejected };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function actionId(c: { need: MatchNeed; source: Facility; destination: Destination; volunteer: Volunteer }): string {
  return `act:${c.need.id}:${c.source.id}>${c.destination.id}:${c.volunteer.id}`;
}

export function fmtDuration(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h} hrs`;
}

function quantityPhrase(kind: ItemKind, quantity: number, unit: string): string {
  if (kind === 'insulin') return `${quantity} insulin ${unit}`;
  if (kind === 'medication') return `${quantity} ${unit} of cold medication`;
  return `${quantity} ${unit}`;
}

/** " Rerouted around X (+0.6 mi)." or "" — appended to explanations. */
export function rerouteNote(trip: TripPlan, closures: readonly RoadClosure[]): string {
  if (!trip.rerouted) return '';
  const labels = trip.closureIds.map((id) => closures.find((r) => r.id === id)?.label ?? id).join(', ');
  return ` Rerouted around ${labels} (+${trip.detourMiles.toFixed(1)} mi).`;
}

function explain(c: Candidate, state: EngineState): string {
  const { need, source, destination, volunteer, trip, quantity } = c;
  const what = quantityPhrase(need.itemKind, quantity, need.unit);
  const who = `${volunteer.name} is ${trip.toSource.distanceMiles.toFixed(1)} mi away, ETA ${Math.ceil(trip.etaMinutes)} min.`;
  let text: string;

  if (need.kind === 'reassign') {
    const original = state.actions.find((a) => a.id === need.replacesActionId);
    const originalVol = state.volunteers.find((v) => v.id === original?.volunteerId);
    const late = original?.completesAt !== undefined ? Math.ceil(original.completesAt - state.simTime) : 0;
    text = `${originalVol?.name ?? 'Current volunteer'} now needs ${late} min to reach ${destination.name}, missing the ${fmtDuration(need.minutesRemaining)} deadline. Reassign: ${who} Protects ${what}.`;
  } else if (need.kind === 'rescue') {
    const dest = state.facilities.find((f) => f.id === destination.id);
    const backup = dest ? backupMinutesRemaining(dest) : null;
    const coldFor =
      backup === null
        ? 'working cold storage on grid power'
        : `cold storage for ${fmtDuration(backup)} on ${dest?.powerSource} power`;
    text = `${source.name} refrigeration fails in ${fmtDuration(need.minutesRemaining)}. ${destination.name} has ${coldFor}. ${who} Protects ${what}.`;
  } else if (need.kind === 'resupply') {
    text = `${destination.name} runs out of ${ITEM_LABELS[need.itemKind].toLowerCase()} in ${fmtDuration(need.minutesRemaining)} (${need.peopleAffected} people). ${source.name} has stock to spare. ${who} Delivers ${what}.`;
  } else {
    const people = `${need.peopleAffected} ${need.vulnerable ? 'vulnerable ' : ''}${need.peopleAffected === 1 ? 'person' : 'people'}`;
    text = `Resident request (${destination.name}): ${ITEM_LABELS[need.itemKind].toLowerCase()} for ${people}. ${source.name} has stock. ${who} Delivers ${what}.`;
  }

  return text + rerouteNote(trip, state.roadClosures);
}

function toAction(c: Candidate, state: EngineState): Action {
  const { need, destination } = c;
  return {
    id: actionId(c),
    type: need.kind === 'reassign' ? 'reroute' : need.kind === 'request' ? 'deliver' : 'transfer',
    needId: need.id,
    fromFacilityId: c.source.id,
    ...(destination.kind === 'facility' ? { toFacilityId: destination.id } : { toRequestId: destination.id }),
    itemKind: need.itemKind,
    quantity: c.quantity,
    volunteerId: c.volunteer.id,
    distanceMiles: c.trip.distanceMiles,
    etaMinutes: c.trip.etaMinutes,
    rerouted: c.trip.rerouted,
    deadlineMinutes: need.minutesRemaining,
    priorityScore: c.score,
    scoreBreakdown: c.breakdown,
    impact: {
      mealsProtected: need.itemKind === 'meals' ? c.quantity : 0,
      dosesProtected: MEDICAL.has(need.itemKind) ? c.quantity : 0,
      peopleHelped: need.peopleAffected,
    },
    explanation: explain(c, state),
    status: 'proposed',
    createdAt: state.simTime,
    ...(need.replacesActionId ? { replacesActionId: need.replacesActionId } : {}),
  };
}

/** Propose actions for every need, best first, without double-booking. */
export function generateActions(state: EngineState): MatchResult {
  const ledger = ledgerFromActions(state);
  let remaining = collectNeedsWith(state, ledger);
  const actions: Action[] = [];
  const lastRejected = new Map<string, RejectedOption[]>();

  while (remaining.length > 0) {
    let best: { need: MatchNeed; feasible: Candidate[]; rejected: RejectedOption[] } | null = null;
    for (const need of remaining) {
      const result = evaluate(need, state, ledger);
      lastRejected.set(need.id, result.rejected);
      const top = result.feasible[0];
      if (!top) continue;
      const bestTop = best?.feasible[0];
      if (!best || !bestTop || top.score > bestTop.score || (top.score === bestTop.score && need.id < best.need.id)) {
        best = { need, ...result };
      }
    }
    if (!best) break;

    const [chosen, ...rest] = best.feasible as [Candidate, ...Candidate[]];
    const action = toAction(chosen, state);
    action.alternatives = rest
      .filter((c) => c.volunteer.id !== chosen.volunteer.id || c.destination.id !== chosen.destination.id)
      .slice(0, ALTERNATIVES_PER_ACTION)
      .map((c) => toAction(c, state));
    action.rejectedOptions = best.rejected.slice(0, MAX_REJECTED_PER_ACTION);
    actions.push(action);

    ledger.bookedVolunteers.add(chosen.volunteer.id);
    if (chosen.need.kind !== 'reassign') {
      add(ledger.outgoing, key(chosen.source.id, chosen.need.itemKind), chosen.quantity);
      if (chosen.destination.kind === 'facility') {
        add(ledger.incoming, key(chosen.destination.id, chosen.need.itemKind), chosen.quantity);
        if (chosen.need.kind === 'rescue') add(ledger.coldIncoming, chosen.destination.id, chosen.quantity);
      }
    }
    const picked = best.need;
    remaining = remaining.filter((n) => n !== picked);
  }

  const unmet = remaining.map((need) => ({ need, rejected: lastRejected.get(need.id) ?? [] }));
  return { actions, unmet };
}

/** Completion time for an approved trip: ETA + loading buffer. */
export function completionMinutes(etaMinutes: number): number {
  return etaMinutes + LOADING_BUFFER_MINUTES;
}
