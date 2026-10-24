/**
 * Pure state reducer for Lifeline OS. No I/O, no wall clock, no randomness:
 * same state + same event/tick → same output, in the browser or in a Lambda.
 *
 * Action lifecycle:
 *   proposed → (ACTION_APPROVED) approved → (next tick) in_progress
 *            → (sim time reaches completesAt) completed
 *   proposed → (ACTION_DECLINED) declined
 *   in_progress → cancelled, when a 'reroute' reassignment for it is approved
 */
import { advanceFacilities, computeClocks, facilityStatusFromClocks } from './clocks';
import {
  completionMinutes,
  destinationFor,
  generateActions,
  isActiveAction,
  rerouteNote,
} from './matcher';
import { planTrip } from './routing';
import type {
  Action,
  EngineEvent,
  EngineEventInput,
  EngineState,
  Facility,
  InventoryItem,
  ItemKind,
  NeedRequest,
} from './types';

const EPSILON = 1e-9;

const COLD_BY_DEFAULT: Record<ItemKind, boolean> = {
  insulin: true,
  medication: true,
  meals: false,
  water: false,
  blankets: false,
};

const DEFAULT_UNITS: Record<ItemKind, string> = {
  insulin: 'doses',
  medication: 'vials',
  meals: 'meals',
  water: 'bottles',
  blankets: 'blankets',
};

export const NO_FREE_VOLUNTEER =
  'All volunteers are assigned to higher-priority actions; next in line when one is free';
export const DECLINED_BY_COORDINATOR = 'Declined by coordinator; escalated for manual follow-up';

/**
 * Recompute everything that is derived: clocks, facility status, proposed
 * actions, pending sync count. Approved / in-progress / completed / declined
 * actions are kept; proposals are regenerated from scratch.
 */
export function deriveState(state: EngineState): EngineState {
  const clocks = computeClocks(state);
  const facilities = state.facilities.map((f) => {
    const status = facilityStatusFromClocks(
      f,
      clocks.filter((c) => c.facilityId === f.id),
    );
    return status === f.status ? f : { ...f, status };
  });
  const withClocks: EngineState = { ...state, facilities, clocks };

  const kept = state.actions.filter((a) => a.status !== 'proposed');
  const previous = new Map(state.actions.map((a) => [a.id, a]));
  const match = generateActions({ ...withClocks, actions: kept });
  const proposals = match.actions.map((a) => {
    const prior = previous.get(a.id);
    return prior?.status === 'proposed' ? { ...a, createdAt: prior.createdAt } : a;
  });

  const waiting = new Map<string, string>();
  for (const a of kept) {
    if (a.status === 'declined' && a.needDismissed && a.toRequestId) waiting.set(a.toRequestId, DECLINED_BY_COORDINATOR);
  }
  for (const { need, rejected } of match.unmet) {
    if (need.kind !== 'request' || !need.destRequestId) continue;
    waiting.set(need.destRequestId, rejected[0]?.reason ?? NO_FREE_VOLUNTEER);
  }
  const requests = state.requests.map((r) => {
    const reason = r.status === 'open' ? waiting.get(r.id) : undefined;
    if (reason === r.waitingReason) return r;
    const next: NeedRequest = { ...r };
    if (reason) next.waitingReason = reason;
    else delete next.waitingReason;
    return next;
  });

  return {
    ...withClocks,
    requests,
    actions: [...kept, ...proposals],
    pendingSyncCount: state.eventLog.reduce((n, e) => (e.synced ? n : n + 1), 0),
  };
}

/**
 * Turn an event input into a full event. Events created while in edge mode are
 * origin 'edge' and unsynced; cloud events are treated as already delivered.
 */
export function stampEvent(
  state: EngineState,
  input: EngineEventInput,
  overrides: { id?: string; simTime?: number } = {},
): EngineEvent {
  const origin = state.connection === 'edge' ? 'edge' : 'cloud';
  const seq = String(state.eventLog.length + 1).padStart(4, '0');
  return {
    ...input,
    id: overrides.id ?? `${origin}-${seq}`,
    simTime: overrides.simTime ?? state.simTime,
    origin,
    synced: origin === 'cloud',
  } as EngineEvent;
}

function updateFacility(
  facilities: Facility[],
  facilityId: string,
  fn: (f: Facility) => Facility,
): Facility[] {
  return facilities.map((f) => (f.id === facilityId ? fn(f) : f));
}

function adjustInventory(f: Facility, kind: ItemKind, delta: number, template?: InventoryItem): Facility {
  const existing = f.inventory.find((i) => i.kind === kind);
  if (existing) {
    return {
      ...f,
      inventory: f.inventory.map((i) => (i === existing ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i)),
    };
  }
  if (delta <= 0) return f;
  const item: InventoryItem = {
    id: `${f.id}-${kind}`,
    kind,
    quantity: delta,
    unit: template?.unit ?? DEFAULT_UNITS[kind],
    requiresColdStorage: template?.requiresColdStorage ?? COLD_BY_DEFAULT[kind],
  };
  return { ...f, inventory: [...f.inventory, item] };
}

/** Find a proposal by id, including alternatives nested under proposals. */
export function findProposal(state: EngineState, actionId: string): Action | undefined {
  for (const a of state.actions) {
    if (a.status !== 'proposed') continue;
    if (a.id === actionId) return a;
    const alt = a.alternatives?.find((x) => x.id === actionId);
    if (alt) return alt;
  }
  return undefined;
}

function setVolunteer(state: EngineState, volunteerId: string, patch: Partial<EngineState['volunteers'][number]>) {
  return state.volunteers.map((v) => {
    if (v.id !== volunteerId) return v;
    const next = { ...v, ...patch };
    if (patch.available) delete next.currentActionId;
    return next;
  });
}

/** Re-plan every active trip against current road closures; flag ones that now miss their deadline. */
function refreshActiveRoutes(state: EngineState): EngineState {
  const actions = state.actions.map((a) => {
    if (!isActiveAction(a) || a.approvedAt === undefined) return a;
    const volunteer = state.volunteers.find((v) => v.id === a.volunteerId);
    const source = state.facilities.find((f) => f.id === a.fromFacilityId);
    const destination = destinationFor(state, a);
    if (!volunteer || !source || !destination) return a;
    const trip = planTrip(volunteer, source, destination, state.roadClosures);
    if (Math.abs(trip.etaMinutes - a.etaMinutes) < EPSILON) return a;
    const completesAt = a.approvedAt + completionMinutes(trip.etaMinutes);
    const base = a.explanation.replace(/ Rerouted around .*$/, '');
    return {
      ...a,
      distanceMiles: trip.distanceMiles,
      etaMinutes: trip.etaMinutes,
      rerouted: trip.rerouted,
      completesAt,
      atRisk: a.deadlineAt !== undefined && completesAt > a.deadlineAt + EPSILON,
      explanation: base + rerouteNote(trip, state.roadClosures),
    };
  });
  return { ...state, actions };
}

function reduceApproved(state: EngineState, event: Extract<EngineEvent, { type: 'ACTION_APPROVED' }>): EngineState {
  const action = findProposal(state, event.actionId);
  if (!action) return state;
  const volunteer = state.volunteers.find((v) => v.id === action.volunteerId);
  if (!volunteer?.available) return state;
  if (action.toRequestId && state.requests.find((r) => r.id === action.toRequestId)?.status !== 'open') return state;

  const t = event.simTime;
  const { alternatives: _alts, rejectedOptions: _rejected, ...rest } = action;
  const approved: Action = {
    ...rest,
    status: 'approved',
    approvedAt: t,
    deadlineAt: t + action.deadlineMinutes,
    completesAt: t + completionMinutes(action.etaMinutes),
  };

  let volunteers = setVolunteer(state, volunteer.id, { available: false, currentActionId: approved.id });
  let actions = state.actions.filter((a) => a.status !== 'proposed');
  if (action.replacesActionId) {
    const original = actions.find((a) => a.id === action.replacesActionId);
    if (original) {
      volunteers = setVolunteer({ ...state, volunteers }, original.volunteerId, { available: true });
      actions = actions.map((a) =>
        a.id === original.id
          ? { ...a, status: 'cancelled' as const, atRisk: false, declineReason: `Reassigned to ${volunteer.name}` }
          : a,
      );
    }
  }

  return {
    ...state,
    volunteers,
    actions: [...actions, approved],
    requests: state.requests.map((r) => (r.id === action.toRequestId ? { ...r, status: 'in_progress' } : r)),
  };
}

function reduceCompleted(state: EngineState, event: Extract<EngineEvent, { type: 'ACTION_COMPLETED' }>): EngineState {
  const action = state.actions.find((a) => a.id === event.actionId);
  if (!action || !isActiveAction(action)) return state;

  const source = state.facilities.find((f) => f.id === action.fromFacilityId);
  const sourceItem = source?.inventory.find((i) => i.kind === action.itemKind);
  const moved = Math.min(action.quantity, Math.floor(sourceItem?.quantity ?? 0));

  let facilities = updateFacility(state.facilities, action.fromFacilityId, (f) =>
    adjustInventory(f, action.itemKind, -moved),
  );
  if (action.toFacilityId) {
    facilities = updateFacility(facilities, action.toFacilityId, (f) => {
      const next = adjustInventory(f, action.itemKind, moved, sourceItem);
      if (sourceItem?.requiresColdStorage && next.refrigeration) {
        return {
          ...next,
          refrigeration: {
            ...next.refrigeration,
            spareCapacityUnits: Math.max(0, next.refrigeration.spareCapacityUnits - moved),
          },
        };
      }
      return next;
    });
  }

  const destination = destinationFor(state, action);
  const volunteers = state.volunteers.map((v) => {
    if (v.id !== action.volunteerId) return v;
    const { currentActionId: _current, ...free } = v;
    return destination ? { ...free, available: true, lat: destination.lat, lng: destination.lng } : { ...free, available: true };
  });

  return {
    ...state,
    facilities,
    volunteers,
    actions: state.actions.map((a) =>
      a.id === action.id
        ? { ...a, status: 'completed', completedAt: event.simTime, quantity: moved, atRisk: false }
        : a,
    ),
    requests: state.requests.map((r) => (r.id === action.toRequestId ? { ...r, status: 'resolved' } : r)),
  };
}

function reduceEvent(state: EngineState, event: EngineEvent): EngineState {
  switch (event.type) {
    case 'DISASTER_STARTED':
      return {
        ...state,
        disaster: {
          type: event.disasterType,
          magnitude: event.magnitude,
          label: event.label,
          startedAt: event.simTime,
        },
      };

    case 'POWER_LOST':
      return {
        ...state,
        facilities: updateFacility(state.facilities, event.facilityId, (f) => {
          if (f.powerSource !== 'grid') return f;
          const backupAvailable = f.backupSource !== undefined && (f.batteryHoursRemaining ?? 0) > 0;
          return backupAvailable
            ? { ...f, powerSource: f.backupSource as 'battery' | 'generator', hasPower: true }
            : { ...f, powerSource: 'none', hasPower: false };
        }),
      };

    case 'REFRIGERATION_FAILED':
      return {
        ...state,
        facilities: updateFacility(state.facilities, event.facilityId, (f) =>
          f.refrigeration ? { ...f, refrigeration: { ...f.refrigeration, working: false } } : f,
        ),
      };

    case 'INVENTORY_CHANGED':
      return {
        ...state,
        facilities: updateFacility(state.facilities, event.facilityId, (f) =>
          adjustInventory(f, event.itemKind, event.delta),
        ),
      };

    case 'DEMAND_INCREASED':
      return {
        ...state,
        facilities: updateFacility(state.facilities, event.facilityId, (f) => {
          const before = f.peopleServed;
          const after = before + event.additionalPeople;
          // Consumption scales with headcount.
          const scale = before > 0 ? after / before : 1;
          return {
            ...f,
            peopleServed: after,
            inventory: f.inventory.map((i) =>
              i.consumptionPerHour ? { ...i, consumptionPerHour: i.consumptionPerHour * scale } : i,
            ),
          };
        }),
      };

    case 'REQUEST_SUBMITTED':
      if (state.requests.some((r) => r.id === event.request.id)) return state;
      return { ...state, requests: [...state.requests, { ...event.request, status: 'open' }] };

    case 'ROAD_CLOSED':
      if (state.roadClosures.some((c) => c.id === event.closure.id)) return state;
      return refreshActiveRoutes({ ...state, roadClosures: [...state.roadClosures, event.closure] });

    case 'ROAD_REOPENED':
      return refreshActiveRoutes({
        ...state,
        roadClosures: state.roadClosures.filter((c) => c.id !== event.closureId),
      });

    case 'ACTION_APPROVED':
      return reduceApproved(state, event);

    case 'ACTION_DECLINED': {
      const action = findProposal(state, event.actionId);
      if (!action) return state;
      const { alternatives: _alts, rejectedOptions: _rejected, ...rest } = action;
      const declined: Action = {
        ...rest,
        status: 'declined',
        ...(event.reason ? { declineReason: event.reason } : {}),
        ...(event.dismissNeed ? { needDismissed: true } : {}),
      };
      return { ...state, actions: [...state.actions.filter((a) => a.status !== 'proposed'), declined] };
    }

    case 'ACTION_COMPLETED':
      return reduceCompleted(state, event);

    case 'CONNECTION_LOST':
      return { ...state, connection: 'edge' };

    case 'CONNECTION_RESTORED':
      return { ...state, connection: 'online' };
  }
}

/**
 * Apply one event and append it to the log. Idempotent by event id:
 * replaying an event that is already in the log is a no-op.
 */
export function applyEvent(state: EngineState, event: EngineEvent): EngineState {
  if (state.eventLog.some((e) => e.id === event.id)) return state;
  const next = reduceEvent(state, event);
  return deriveState({ ...next, eventLog: [...next.eventLog, event] });
}

/** Convenience: stamp an input with the current sim time / connection and apply it. */
export function dispatchEvent(state: EngineState, input: EngineEventInput): EngineState {
  return applyEvent(state, stampEvent(state, input));
}

/** Mark events as acknowledged by the backend. Not an event itself; only flips flags. */
export function markEventsSynced(state: EngineState, ids: Iterable<string>): EngineState {
  const target = new Set(ids);
  if (target.size === 0) return state;
  const eventLog = state.eventLog.map((e) => (!e.synced && target.has(e.id) ? { ...e, synced: true } : e));
  return { ...state, eventLog, pendingSyncCount: eventLog.reduce((n, e) => (e.synced ? n : n + 1), 0) };
}

// ---------------------------------------------------------------------------
// Coordinator commands
// ---------------------------------------------------------------------------

/** Approve a proposal (or one of its alternatives). No-op if it is no longer valid. */
export function approveAction(state: EngineState, actionId: string): EngineState {
  const action = findProposal(state, actionId);
  if (!action) return state;
  if (!state.volunteers.find((v) => v.id === action.volunteerId)?.available) return state;
  return dispatchEvent(state, { type: 'ACTION_APPROVED', actionId });
}

/** Decline a proposal. That exact (need, source, destination, volunteer) combo is never re-proposed. */
/** "Decline": the coordinator rejects the need, so nothing more is proposed for it. */
export function declineAction(state: EngineState, actionId: string, reason?: string): EngineState {
  if (!findProposal(state, actionId)) return state;
  return dispatchEvent(state, { type: 'ACTION_DECLINED', actionId, dismissNeed: true, ...(reason ? { reason } : {}) });
}

/** "Find Alternative": rule out only this option so the next-best one for the same need is proposed. */
export function requestAlternative(state: EngineState, actionId: string): EngineState {
  if (!findProposal(state, actionId)) return state;
  return dispatchEvent(state, { type: 'ACTION_DECLINED', actionId, reason: 'Alternative requested' });
}

/** The current proposal for a need, if any (e.g. after requestAlternative). */
export function proposalForNeed(state: EngineState, needId: string): Action | undefined {
  return state.actions.find((a) => a.status === 'proposed' && a.needId === needId);
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

function advancePhysics(state: EngineState, dtMinutes: number): EngineState {
  if (dtMinutes <= EPSILON) return state;
  const { facilities, losses } = advanceFacilities(state.facilities, dtMinutes, state.simTime);
  return {
    ...state,
    simTime: state.simTime + dtMinutes,
    facilities,
    lostInventory: losses.length ? [...state.lostInventory, ...losses] : state.lostInventory,
  };
}

function nextCompletion(state: EngineState, until: number): number | null {
  let next: number | null = null;
  for (const a of state.actions) {
    if (!isActiveAction(a) || a.completesAt === undefined) continue;
    if (a.completesAt <= until + EPSILON && (next === null || a.completesAt < next)) next = a.completesAt;
  }
  return next;
}

/**
 * Advance the simulation clock by dtMinutes of sim time.
 * Approved actions are dispatched (→ in_progress); any action whose completion
 * time falls inside the tick completes at that exact sim minute.
 */
export function tick(state: EngineState, dtMinutes: number): EngineState {
  if (dtMinutes <= 0) return state;
  const target = state.simTime + dtMinutes;
  let s: EngineState = {
    ...state,
    actions: state.actions.map((a) => (a.status === 'approved' ? { ...a, status: 'in_progress' } : a)),
  };

  for (;;) {
    const due = nextCompletion(s, target);
    s = advancePhysics(s, (due ?? target) - s.simTime);
    if (due === null) break;
    for (const a of s.actions) {
      if (isActiveAction(a) && a.completesAt !== undefined && a.completesAt <= s.simTime + EPSILON) {
        const id = `complete:${a.id}@${a.approvedAt ?? 0}`;
        s = applyEvent(s, stampEvent(s, { type: 'ACTION_COMPLETED', actionId: a.id }, { id }));
      }
    }
  }
  return deriveState({ ...s, simTime: target });
}
