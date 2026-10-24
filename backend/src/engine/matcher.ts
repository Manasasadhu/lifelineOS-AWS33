import { Action, EmergencyRequest, Facility, WorldState } from "../types";
import { remainingHours } from "./clocks";
import { estimateRoute, findById } from "./geo";
import { priorityScore } from "./priority";

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function volunteers(state: WorldState): Facility[] {
  return state.facilities.filter((f) => f.type === "volunteer" && f.available !== false);
}

function hasPending(state: WorldState, fromId: string, item: string): boolean {
  return state.actions.some(
    (a) => a.fromFacilityId === fromId && a.item === item && (a.status === "pending" || a.status === "approved"),
  );
}

function coldDestinations(state: WorldState, exclude: string[] = []): Facility[] {
  return state.facilities.filter((f) => {
    if (exclude.includes(f.id)) return false;
    if (f.type === "volunteer" || f.type === "pharmacy") return false;
    if (!f.power) return false;
    const hours = remainingHours(f);
    return hours != null && hours >= 8;
  });
}

function pickDriver(state: WorldState, from: Facility): Facility | undefined {
  const available = volunteers(state);
  return available.sort((a, b) => estimateRoute(state, from, a).etaMinutes - estimateRoute(state, from, b).etaMinutes)[0];
}

function buildAction(
  state: WorldState,
  args: {
    from: Facility;
    to: Facility;
    item: string;
    quantity: number;
    title: string;
    reason: string;
    impact: string;
    severity: Action["severity"];
    urgency: EmergencyRequest["urgency"];
    excluded?: string[];
  },
): Action {
  const driver = pickDriver(state, args.from);
  const route = estimateRoute(state, args.from, args.to);
  const score = priorityScore({
    urgency: args.urgency,
    peopleAffected: Math.max(args.from.peopleServed, args.to.peopleServed, args.quantity),
    source: args.from,
    destination: args.to,
    distanceMiles: route.distanceMiles,
    roadClosed: route.detour,
  });

  return {
    id: newId("act"),
    severity: args.severity,
    title: args.title,
    reason: `${args.reason} (priority ${score.toFixed(1)})`,
    fromFacilityId: args.from.id,
    toFacilityId: args.to.id,
    driverId: driver?.id ?? null,
    item: args.item,
    quantity: args.quantity,
    distanceMiles: route.distanceMiles,
    etaMinutes: route.etaMinutes,
    coldStorageHoursRemaining: remainingHours(args.to),
    estimatedImpact: args.impact,
    status: "pending",
    createdAt: new Date().toISOString(),
    excludedDestinationIds: args.excluded,
    explanation:
      "AI proposed this transfer. A rule engine scored urgency, people affected, time-to-failure, and distance. A human operator must approve.",
  };
}

export function generateInterventions(state: WorldState): Action[] {
  const created: Action[] = [];
  const pharmacy = findById(state, "pharmacy-a");
  const foodBank = findById(state, "food-bank-b");
  const grocery = findById(state, "grocery-e");
  const shelter = findById(state, "shelter-c");

  if (pharmacy && !pharmacy.power && (remainingHours(pharmacy) ?? 99) < 2) {
    const insulin = pharmacy.inventory.find((i) => i.item === "insulin");
    if (insulin && insulin.quantity > 0 && !hasPending(state, pharmacy.id, "insulin")) {
      const dests = coldDestinations(state, [pharmacy.id]).sort(
        (a, b) => (remainingHours(b) ?? 0) - (remainingHours(a) ?? 0),
      );
      const to = dests[0];
      if (to) {
        created.push(
          buildAction(state, {
            from: pharmacy,
            to,
            item: "insulin",
            quantity: insulin.quantity,
            title: "Medication refrigeration failure",
            reason: `${pharmacy.name} refrigeration failure predicted`,
            impact: `${insulin.quantity} medication doses protected`,
            severity: "critical",
            urgency: "critical",
          }),
        );
      }
    }
  }

  if (foodBank && (remainingHours(foodBank) ?? 99) < 3) {
    const meals = foodBank.inventory.find((i) => i.item === "meals");
    if (meals && meals.quantity > 0 && shelter && !hasPending(state, foodBank.id, "meals")) {
      created.push(
        buildAction(state, {
          from: foodBank,
          to: shelter,
          item: "meals",
          quantity: meals.quantity,
          title: "Meals at risk of spoilage",
          reason: `${foodBank.name} refrigeration at risk; ${shelter.name} needs food`,
          impact: `${meals.quantity} meals rescued`,
          severity: "at_risk",
          urgency: "high",
        }),
      );
    }
  }

  if (grocery && grocery.inventory.some((i) => i.atRisk)) {
    const meals = grocery.inventory.find((i) => i.item === "meals");
    if (meals && meals.quantity > 0 && shelter && !hasPending(state, grocery.id, "meals")) {
      const qty = Math.min(150, meals.quantity);
      created.push(
        buildAction(state, {
          from: grocery,
          to: shelter,
          item: "meals",
          quantity: qty,
          title: "Grocery perishables at risk",
          reason: `${grocery.name} has meals at risk of spoiling while ${shelter.name} has demand`,
          impact: `${qty} meals rescued`,
          severity: "warning",
          urgency: "high",
        }),
      );
    }
  }

  return created;
}

export function matchRequest(state: WorldState, request: EmergencyRequest): Action | null {
  const need = request.need.toLowerCase();
  if (need.includes("insulin") || need.includes("medication")) {
    const pharmacy = findById(state, "pharmacy-a");
    const dests = coldDestinations(state);
    const to = dests[0];
    if (!pharmacy || !to) return null;
    const qty = Math.min(25, pharmacy.inventory.find((i) => i.item === "insulin")?.quantity ?? 0);
    if (qty <= 0) return null;
    if (hasPending(state, pharmacy.id, "insulin")) return null;
    return buildAction(state, {
      from: pharmacy,
      to,
      item: "insulin",
      quantity: qty,
      title: "Resident insulin request",
      reason: `Citizen request: ${request.rawText}`,
      impact: `${qty} medication doses protected · ${request.people} resident(s) assisted`,
      severity: "critical",
      urgency: request.urgency,
    });
  }

  if (need.includes("meal") || need.includes("food")) {
    const grocery = findById(state, "grocery-e");
    const foodBank = findById(state, "food-bank-b");
    const shelter = findById(state, "shelter-c") ?? state.facilities.find((f) => f.type === "shelter");
    const source = foodBank && (foodBank.inventory.find((i) => i.item === "meals")?.quantity ?? 0) > 0 ? foodBank : grocery;
    if (!source || !shelter) return null;
    const available = source.inventory.find((i) => i.item === "meals")?.quantity ?? 0;
    const qty = Math.min(Math.max(request.people, 1) * 3, available);
    if (qty <= 0) return null;
    return buildAction(state, {
      from: source,
      to: shelter,
      item: "meals",
      quantity: qty,
      title: "Food request",
      reason: `Citizen request: ${request.rawText}`,
      impact: `${qty} meals staged for ${request.people} people`,
      severity: "warning",
      urgency: request.urgency,
    });
  }

  return null;
}

export function findAlternative(state: WorldState, action: Action): Action | null {
  const from = findById(state, action.fromFacilityId);
  if (!from) return null;
  const excluded = [...(action.excludedDestinationIds ?? []), action.toFacilityId];
  const dests = coldDestinations(state, excluded);
  const to = dests[0] ?? state.facilities.find((f) => f.id !== action.toFacilityId && f.id !== from.id && f.type !== "volunteer");
  if (!from || !to) return null;
  const next = generateInterventions({ ...state, actions: state.actions.filter((a) => a.id !== action.id) });
  const rebuilt = next.find((a) => a.fromFacilityId === from.id && a.item === action.item);
  if (rebuilt) {
    return { ...rebuilt, excludedDestinationIds: excluded, status: "pending", title: `${rebuilt.title} (alternative)` };
  }
  return buildAction(state, {
    from,
    to,
    item: action.item,
    quantity: action.quantity,
    title: `${action.title} (alternative)`,
    reason: `Previous destination declined. Rerouting around ${action.toFacilityId}.`,
    impact: action.estimatedImpact,
    severity: action.severity,
    urgency: "high",
    excluded,
  });
}

export function applyApproval(state: WorldState, action: Action): WorldState {
  const facilities = state.facilities.map((f) => ({ ...f, inventory: f.inventory.map((i) => ({ ...i })) }));
  const from = facilities.find((f) => f.id === action.fromFacilityId);
  const to = facilities.find((f) => f.id === action.toFacilityId);
  const driver = facilities.find((f) => f.id === action.driverId);

  if (from) {
    const item = from.inventory.find((i) => i.item === action.item);
    if (item) item.quantity = Math.max(0, item.quantity - action.quantity);
    if (action.item === "insulin" && item && item.quantity === 0) {
      from.failureAt = null;
      from.refrigerationHoursRemaining = from.power ? 12 : 0.2;
    }
  }
  if (to) {
    const item = to.inventory.find((i) => i.item === action.item);
    if (item) item.quantity += action.quantity;
    else to.inventory.push({ item: action.item, quantity: action.quantity, unit: action.item === "insulin" ? "doses" : "meals", coldChain: action.item === "insulin" });
  }
  if (driver) driver.available = true;

  const impact = { ...state.impact };
  if (action.item === "meals") impact.mealsRescued += action.quantity;
  if (action.item === "insulin") impact.dosesProtected += action.quantity;
  impact.residentsAssisted += action.item === "insulin" ? 1 : Math.max(1, Math.round(action.quantity / 3));
  impact.requestsResolved += 1;
  impact.milesAvoided += Number((action.distanceMiles * 0.35).toFixed(1));
  impact.avgResponseAfterMin = 7;
  impact.resourcesPreservedPct = Math.min(99, 40 + impact.requestsResolved * 8);

  const actions = state.actions.map((a) => (a.id === action.id ? { ...a, status: "approved" as const } : a));
  const requests = state.requests.map((r) =>
    r.status === "open" && action.reason.toLowerCase().includes("citizen") ? { ...r, status: "matched" as const } : r,
  );

  return {
    ...state,
    facilities,
    actions,
    requests,
    impact,
    logs: [...state.logs, `Approved: ${action.title} (${action.quantity} ${action.item} → ${action.toFacilityId}).`],
  };
}

export function rerouteBlockedActions(state: WorldState): WorldState {
  if (!state.incident.roadClosed) return state;
  let next = state;
  const pending = state.actions.filter((a) => a.status === "pending");
  for (const action of pending) {
    const from = findById(next, action.fromFacilityId);
    const to = findById(next, action.toFacilityId);
    if (!from || !to) continue;
    const route = estimateRoute(next, from, to);
    next = {
      ...next,
      actions: next.actions.map((a) =>
        a.id === action.id
          ? {
              ...a,
              status: route.detour ? "rerouted" : a.status,
              distanceMiles: route.distanceMiles,
              etaMinutes: route.etaMinutes,
              reason: route.detour ? `${a.reason} · rerouted around closed road` : a.reason,
            }
          : a,
      ),
      logs: route.detour ? [...next.logs, `Rerouted ${action.id} around closed road.`] : next.logs,
    };
  }
  return next;
}
