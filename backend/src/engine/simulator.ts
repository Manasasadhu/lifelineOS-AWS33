import { createSeedState } from "../data/seed";
import { WorldState } from "../types";
import { refreshDerived } from "./clocks";
import { generateInterventions, rerouteBlockedActions } from "./matcher";

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

export function applyEarthquake(state: WorldState): WorldState {
  const startedAt = new Date().toISOString();
  let next: WorldState = {
    ...state,
    incident: {
      active: true,
      type: "earthquake",
      location: "San José",
      startedAt,
      label: "EARTHQUAKE RESPONSE ACTIVE",
      elapsedLabel: "00:00:00",
      roadClosed: false,
      roadName: null,
    },
    logs: [...state.logs, "SIMULATE DISASTER: 7.0 earthquake — San José."],
  };

  next.facilities = next.facilities.map((f) => {
    if (f.id === "pharmacy-a") {
      return {
        ...f,
        power: false,
        failureAt: hoursFromNow(46 / 60),
        notes: "Power outage. Refrigeration failing — insulin at risk.",
      };
    }
    if (f.id === "food-bank-b") {
      return {
        ...f,
        power: false,
        failureAt: hoursFromNow(1 + 24 / 60),
        notes: "Refrigeration failure. 243 meals at risk.",
      };
    }
    if (f.id === "grocery-e") {
      return {
        ...f,
        power: false,
        failureAt: hoursFromNow(2.5),
        inventory: f.inventory.map((i) => (i.item === "meals" ? { ...i, atRisk: true, quantity: 150 } : i)),
        notes: "150 meals at risk of spoiling.",
      };
    }
    if (f.id === "shelter-c") {
      return {
        ...f,
        peopleServed: 40,
        failureAt: hoursFromNow(5),
        notes: "Demand increased. Food supply limited.",
      };
    }
    return f;
  });

  next.requests = [
    ...next.requests,
    {
      id: `req-sim-${Date.now().toString(36)}`,
      rawText: "Our shelter needs meals for 40 people.",
      need: "meals",
      urgency: "high",
      people: 40,
      powerAvailable: true,
      location: "Shelter C, San José",
      source: "rules",
      createdAt: startedAt,
      status: "open",
    },
  ];

  next = refreshDerived(next);
  const actions = generateInterventions(next);
  next = { ...next, actions: [...next.actions, ...actions] };
  next.logs = [...next.logs, `Generated ${actions.length} recommended intervention(s).`];
  return next;
}

export function closeRoad(state: WorldState): WorldState {
  let next: WorldState = {
    ...state,
    incident: {
      ...state.incident,
      roadClosed: true,
      roadName: "E Santa Clara St corridor",
    },
    logs: [...state.logs, "EVENT: Road closed — E Santa Clara St corridor. Recalculating routes."],
  };
  next = rerouteBlockedActions(next);
  return refreshDerived(next);
}

export function resetWorld(): WorldState {
  return createSeedState();
}
