/**
 * Path B adapter: translate Engineer 3's (Kavya's) pure engine state
 * (`src/engine`, EngineState) into the existing public `/state` shape that
 * the frontend and the current API contract already consume.
 *
 * The frontend is coded against the ORIGINAL shape (types.ts in backend/src),
 * so this adapter keeps that contract identical while the brain underneath
 * becomes the richer event-sourced engine.
 */
import {
  computeImpact,
  type Action as V2Action,
  type EngineState as V2State,
  type Facility as V2Facility,
  type SurvivalClock as V2Clock,
} from "@lifeline/engine";
import {
  Action,
  Alert,
  Facility,
  Impact,
  Incident,
  Severity,
  WorldState,
} from "../types";

/** Wall-clock anchor: sim time is minutes; we project failures onto real time
 * so the frontend countdowns (which use remainingSeconds / failureAt) keep working. */
function failureAtFromMinutes(minutesRemaining: number): string {
  return new Date(Date.now() + minutesRemaining * 60_000).toISOString();
}

const STATUS_MAP: Record<V2Facility["status"], Severity> = {
  stable: "healthy",
  limited: "warning",
  at_risk: "at_risk",
  critical: "critical",
};

const CLOCK_SEVERITY_MAP: Record<V2Clock["severity"], Severity> = {
  stable: "healthy",
  warning: "warning",
  at_risk: "at_risk",
  critical: "critical",
};

/** Worst (soonest) clock for a facility, if any. */
function worstClock(state: V2State, facilityId: string): V2Clock | undefined {
  return state.clocks
    .filter((c) => c.facilityId === facilityId)
    .sort((a, b) => a.minutesRemaining - b.minutesRemaining)[0];
}

function worstColdClock(state: V2State, facilityId: string): V2Clock | undefined {
  return state.clocks
    .filter((c) => c.facilityId === facilityId && c.kind === "cold_storage")
    .sort((a, b) => a.minutesRemaining - b.minutesRemaining)[0];
}

function mapFacility(state: V2State, f: V2Facility): Facility {
  const cold = worstColdClock(state, f.id);
  const worst = worstClock(state, f.id);
  const refrigerationHoursRemaining = cold ? cold.minutesRemaining / 60 : null;
  // failureAt reflects the soonest survival clock; null when the facility is stable.
  const failureAt = worst ? failureAtFromMinutes(worst.minutesRemaining) : null;
  return {
    id: f.id,
    name: f.name,
    type: f.type as Facility["type"],
    status: STATUS_MAP[f.status],
    lat: f.lat,
    lng: f.lng,
    power: f.hasPower,
    refrigerationHoursRemaining,
    failureAt,
    inventory: f.inventory.map((i) => ({
      item: i.kind,
      quantity: i.quantity,
      unit: i.unit,
      coldChain: i.requiresColdStorage,
      atRisk: i.requiresColdStorage && f.refrigeration?.working === false,
    })),
    peopleServed: f.peopleServed,
    notes: worst?.cause,
  };
}

/** Volunteers live in a separate array in v2; the old shape modeled them as facilities. */
function mapVolunteers(state: V2State): Facility[] {
  return state.volunteers.map((v) => ({
    id: v.id,
    name: v.name,
    type: "volunteer" as const,
    status: (v.available ? "healthy" : "warning") as Severity,
    lat: v.lat,
    lng: v.lng,
    power: true,
    refrigerationHoursRemaining: null,
    failureAt: null,
    inventory: [],
    peopleServed: 0,
    available: v.available,
    notes: v.hasCooler ? "Refrigerated vehicle" : v.vehicle,
  }));
}

const ACTION_SEVERITY: Record<string, Action["severity"]> = {
  critical: "critical",
  high: "at_risk",
  medium: "warning",
  low: "warning",
};

function mapAction(state: V2State, a: V2Action): Action {
  const sev = ACTION_SEVERITY[a.scoreBreakdown?.urgency ?? "medium"] ?? "warning";
  const toId = a.toFacilityId ?? a.toRequestId ?? "";
  const cold = a.toFacilityId ? worstColdClock(state, a.toFacilityId) : undefined;
  const impactParts: string[] = [];
  if (a.impact.dosesProtected) impactParts.push(`${a.impact.dosesProtected} doses protected`);
  if (a.impact.mealsProtected) impactParts.push(`${a.impact.mealsProtected} meals rescued`);
  if (a.impact.peopleHelped) impactParts.push(`${a.impact.peopleHelped} people helped`);
  return {
    id: a.id,
    severity: sev,
    title: titleFor(a),
    reason: `${a.explanation} (priority ${a.priorityScore.toFixed(1)})`,
    fromFacilityId: a.fromFacilityId,
    toFacilityId: toId,
    driverId: a.volunteerId ?? null,
    item: a.itemKind,
    quantity: a.quantity,
    distanceMiles: a.distanceMiles,
    etaMinutes: Math.round(a.etaMinutes),
    coldStorageHoursRemaining: cold ? cold.minutesRemaining / 60 : null,
    estimatedImpact: impactParts.join(" · ") || a.explanation,
    status: mapActionStatus(a.status),
    createdAt: new Date().toISOString(),
    explanation: a.explanation,
  };
}

function titleFor(a: V2Action): string {
  if (a.itemKind === "insulin" || a.itemKind === "medication") return "Medication refrigeration failure";
  if (a.itemKind === "meals") return "Meals at risk of spoilage";
  return `${a.itemKind} transfer`;
}

function mapActionStatus(s: V2Action["status"]): Action["status"] {
  switch (s) {
    case "proposed":
      return "pending";
    case "in_progress":
      return "approved";
    case "cancelled":
      return "declined";
    default:
      return s as Action["status"];
  }
}

function mapIncident(state: V2State): Incident {
  const d = state.disaster;
  if (!d) {
    return {
      active: false,
      type: "none",
      location: "San José",
      startedAt: null,
      label: "STANDBY",
      elapsedLabel: "00:00:00",
      roadClosed: false,
      roadName: null,
    };
  }
  return {
    active: true,
    type: d.type,
    location: "San José",
    startedAt: new Date(Date.now() - (state.simTime - d.startedAt) * 60_000).toISOString(),
    label: "EARTHQUAKE RESPONSE ACTIVE",
    elapsedLabel: "00:00:00",
    roadClosed: state.roadClosures.length > 0,
    roadName: state.roadClosures[0]?.label ?? null,
  };
}

function mapImpact(state: V2State): Impact {
  const m = computeImpact(state);
  return {
    mealsRescued: m.mealsRescued + m.mealsDelivered,
    dosesProtected: m.dosesProtected,
    residentsAssisted: m.residentsAssisted,
    requestsResolved: m.requestsResolved,
    milesAvoided: Number(m.milesAvoided.toFixed(1)),
    avgResponseBeforeMin: m.baselineResponseMinutes,
    avgResponseAfterMin: m.avgResponseMinutes != null ? Math.round(m.avgResponseMinutes) : m.baselineResponseMinutes,
    resourcesPreservedPct: m.criticalPreservedPercent != null ? Math.round(m.criticalPreservedPercent) : 0,
    simulation: true,
  };
}

function mapAlerts(state: V2State): Alert[] {
  return state.clocks
    .filter((c) => c.severity !== "stable")
    .map((c) => ({
      id: `alert-${c.resourceId}`,
      severity: CLOCK_SEVERITY_MAP[c.severity],
      title: facilityName(state, c.facilityId),
      subtitle: c.label,
      remainingSeconds: Math.round(c.minutesRemaining * 60),
      facilityId: c.facilityId,
    }));
}

function facilityName(state: V2State, id: string): string {
  return state.facilities.find((f) => f.id === id)?.name ?? id;
}

/** The single translation entry point: v2 EngineState -> public WorldState. */
export function toWorldState(state: V2State): WorldState {
  const facilities = [...state.facilities.map((f) => mapFacility(state, f)), ...mapVolunteers(state)];
  const actions = state.actions
    .filter((a) => a.status !== "completed" || a.itemKind != null)
    .map((a) => mapAction(state, a));
  return {
    version: state.eventLog.length,
    connection: state.connection === "edge" ? "edge" : "cloud",
    incident: mapIncident(state),
    facilities,
    actions,
    requests: state.requests.map((r) => ({
      id: r.id,
      rawText: r.rawText ?? "",
      need: r.needKind,
      urgency: r.urgency,
      people: r.peopleAffected,
      powerAvailable: r.powerAvailable ?? null,
      location: r.locationLabel,
      source: "rules" as const,
      createdAt: new Date().toISOString(),
      status: r.status === "resolved" ? "resolved" : r.status === "open" ? "open" : "matched",
    })),
    alerts: mapAlerts(state),
    impact: mapImpact(state),
    offlineEvents: state.eventLog
      .filter((e) => !e.synced)
      .map((e) => ({ eventId: e.id, kind: "note" as const, payload: {}, createdAt: new Date().toISOString() })),
    logs: [],
  };
}
