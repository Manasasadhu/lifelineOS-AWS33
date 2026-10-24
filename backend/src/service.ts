import { emitSimulationEvents, notifyAction } from "./aws/sideEffects";
import { refreshDerived } from "./engine/clocks";
import { applyApproval, findAlternative, generateInterventions, matchRequest } from "./engine/matcher";
import { parseRequest } from "./engine/parser";
import { applyEarthquake, closeRoad, resetWorld } from "./engine/simulator";
import { getStore } from "./store";
import { EmergencyRequest, OfflineEvent, WorldState } from "./types";

function bump(state: WorldState): WorldState {
  return { ...state, version: state.version + 1 };
}

export async function getState(): Promise<WorldState> {
  const state = refreshDerived(await getStore().load());
  return state;
}

export async function getImpact(): Promise<WorldState["impact"]> {
  const state = await getState();
  return state.impact;
}

export async function simulateDisaster(): Promise<WorldState> {
  const store = getStore();
  let state = refreshDerived(applyEarthquake(await store.load()));
  state = bump(state);
  await store.save(state);
  await emitSimulationEvents().catch((err) => console.warn("EventBridge emit failed", err));
  const critical = state.actions.find((a) => a.severity === "critical" && a.status === "pending");
  if (critical) await notifyAction(critical, state).catch((err) => console.warn("SNS failed", err));
  return state;
}

export async function simulateRoadClose(): Promise<WorldState> {
  const store = getStore();
  const state = bump(refreshDerived(closeRoad(await store.load())));
  await store.save(state);
  return state;
}

export async function resetSimulation(): Promise<WorldState> {
  const store = getStore();
  const state = resetWorld();
  await store.save(state);
  return refreshDerived(state);
}

export async function setConnection(mode: "cloud" | "edge"): Promise<WorldState> {
  const store = getStore();
  let state = await store.load();
  if (mode === "edge") {
    state = {
      ...state,
      connection: "edge",
      logs: [...state.logs, "CLOUD DISCONNECTED · LIFELINE EDGE MODE. Local prioritization active."],
    };
  } else {
    const pending = state.offlineEvents.length;
    state = {
      ...state,
      connection: "cloud",
      logs: [...state.logs, pending ? `RESTORE CONNECTION. Synchronizing ${pending} offline events…` : "Connection restored."],
    };
  }
  state = bump(refreshDerived(state));
  await store.save(state);
  return state;
}

export async function submitRequest(text: string): Promise<{ parsed: Awaited<ReturnType<typeof parseRequest>>; state: WorldState }> {
  const parsed = await parseRequest(text);
  const store = getStore();
  let state = await store.load();
  const request: EmergencyRequest = {
    id: `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    rawText: text,
    need: parsed.need,
    urgency: parsed.urgency,
    people: parsed.people,
    powerAvailable: parsed.powerAvailable,
    location: parsed.location,
    source: parsed.source,
    createdAt: new Date().toISOString(),
    status: "open",
  };
  state.requests = [...state.requests, request];
  const action = matchRequest(state, request);
  if (action) {
    state.actions = [...state.actions, action];
    request.status = "matched";
  }
  state.logs = [...state.logs, `Request parsed (${parsed.source}): need=${parsed.need} urgency=${parsed.urgency}.`];
  if (state.connection === "edge") {
    state.offlineEvents = [
      ...state.offlineEvents,
      { eventId: request.id, kind: "request", payload: { text }, createdAt: request.createdAt },
    ];
  }
  state = bump(refreshDerived(state));
  await store.save(state);
  return { parsed, state };
}

export async function mutateAction(id: string, op: "approve" | "decline" | "alternative"): Promise<WorldState> {
  const store = getStore();
  let state = await store.load();
  const action = state.actions.find((a) => a.id === id);
  if (!action) {
    const err = new Error("Action not found");
    (err as Error & { statusCode: number }).statusCode = 404;
    throw err;
  }

  if (op === "approve") {
    state = applyApproval(state, action);
    await notifyAction({ ...action, status: "approved" }, state).catch(() => undefined);
  } else if (op === "decline") {
    state = {
      ...state,
      actions: state.actions.map((a) => (a.id === id ? { ...a, status: "declined" as const } : a)),
      logs: [...state.logs, `Declined action ${id}.`],
    };
  } else {
    const alt = findAlternative(state, action);
    state = {
      ...state,
      actions: state.actions.map((a) => (a.id === id ? { ...a, status: "declined" as const } : a)).concat(alt ? [alt] : []),
      logs: [...state.logs, alt ? `Alternative generated for ${id}.` : `No alternative for ${id}.`],
    };
  }

  if (state.connection === "edge") {
    state.offlineEvents.push({
      eventId: `${op}-${id}-${Date.now()}`,
      kind: op === "approve" ? "approve" : "decline",
      payload: { id, op },
      createdAt: new Date().toISOString(),
    });
  }

  state = bump(refreshDerived(state));
  await store.save(state);
  return state;
}

export async function syncOffline(events: OfflineEvent[]): Promise<{ applied: number; state: WorldState }> {
  const seen = new Set<string>();
  let applied = 0;
  for (const event of events) {
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    if (event.kind === "request" && typeof event.payload.text === "string") {
      await submitRequest(event.payload.text);
      applied += 1;
    } else if ((event.kind === "approve" || event.kind === "decline") && typeof event.payload.id === "string") {
      try {
        await mutateAction(event.payload.id, event.kind === "approve" ? "approve" : "decline");
        applied += 1;
      } catch {
        /* missing or already applied */
      }
    } else {
      applied += 1;
    }
  }

  const store = getStore();
  let state = await store.load();
  state = {
    ...state,
    connection: "cloud",
    offlineEvents: [],
    logs: [...state.logs, `✓ Synchronization complete (${applied} events).`],
  };
  state = bump(refreshDerived(state));
  await store.save(state);
  return { applied, state };
}

export async function regenerateActions(): Promise<WorldState> {
  const store = getStore();
  let state = await store.load();
  const extra = generateInterventions(state);
  state = bump(refreshDerived({ ...state, actions: [...state.actions, ...extra] }));
  await store.save(state);
  return state;
}

export function publicSummary(state: WorldState) {
  const peopleAffected = state.incident.active ? 1248 : state.requests.reduce((n, r) => n + r.people, 0);
  return {
    ...state,
    metrics: {
      peopleAffected,
      requestsActive: state.requests.filter((r) => r.status !== "resolved").length,
      resourcesAvailable: state.facilities.length,
      criticalAlerts: state.alerts.filter((a) => a.severity === "critical").length,
    },
    priorityQueue: state.alerts.slice(0, 5).map((a) => ({
      id: a.id,
      severity: a.severity,
      title: a.title,
      subtitle: a.subtitle,
      remainingSeconds: a.remainingSeconds,
    })),
  };
}

export type PublicState = ReturnType<typeof publicSummary>;

export function contract() {
  return {
    service: "Lifeline OS API",
    version: "0.1",
    endpoints: [
      "GET /health",
      "GET /state",
      "GET /impact",
      "GET /contract",
      "POST /simulate",
      "POST /simulate/reset",
      "POST /simulate/road-close",
      "POST /requests  { text }",
      "POST /actions/:id/approve",
      "POST /actions/:id/decline",
      "POST /actions/:id/alternative",
      "POST /connection  { mode: cloud|edge }",
      "POST /sync  { events: OfflineEvent[] }",
    ],
  };
}

