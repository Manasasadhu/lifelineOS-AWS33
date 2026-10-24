/**
 * Path B service: same public surface as backend/src/service.ts, but every
 * operation runs on Engineer 3's engine via EngineV2Store, then is translated
 * to the public WorldState with the adapter. The router can call either
 * service; this one is selected when ENGINE_V2=true.
 */
import type { ParsedRequest as EngineParsed } from "@lifeline/engine";
import { ParsedRequest, WorldState } from "../types";
import type { EngineState } from "@lifeline/engine";
import { toWorldState } from "./adapter";
import { parseWithBedrock } from "./bedrock";
import { getStore, type EngineV2Store } from "./store";

/** Map Engineer 3's ParsedRequest to the public ParsedRequest shape the frontend reads. */
function mapParsed(p: EngineParsed): ParsedRequest {
  return {
    need: p.needKind ?? "unknown",
    urgency: p.urgency ?? "medium",
    people: p.peopleAffected ?? 1,
    powerAvailable: p.powerAvailable ?? null,
    location: "Downtown San José",
    source: p.parser === "bedrock" ? "bedrock" : "rules",
  };
}

const world = (store: EngineV2Store, state: EngineState): WorldState =>
  toWorldState(state, store.getHistory(), store.getStamps());

export async function getState(): Promise<WorldState> {
  const store = await getStore();
  return world(store, store.get());
}

export async function getImpact(): Promise<WorldState["impact"]> {
  const store = await getStore();
  return world(store, store.get()).impact;
}

export async function simulateDisaster(scenario?: string): Promise<WorldState> {
  const store = await getStore();
  return world(store, store.simulate(scenario));
}

export async function simulateRoadClose(): Promise<WorldState> {
  // Every scripted scenario closes a road by T+6; advancing past it triggers the reroute.
  const store = await getStore();
  return world(store, store.advance(6));
}

export async function resetSimulation(): Promise<WorldState> {
  const store = await getStore();
  return world(store, store.reset());
}

export async function setConnection(mode: "cloud" | "edge"): Promise<WorldState> {
  const store = await getStore();
  return world(store, store.setConnection(mode));
}

export async function submitRequest(
  text: string,
): Promise<{ parsed: ParsedRequest; state: WorldState; requestId?: string }> {
  // Try Bedrock (Amazon Nova) first; null → store uses the local keyword parser.
  const bedrock = await parseWithBedrock(text);
  const store = await getStore();
  const { state, parsed, request } = store.submitRequest(text, bedrock ?? undefined);
  return { parsed: mapParsed(parsed), state: world(store, state), requestId: request?.id };
}

export async function mutateAction(
  id: string,
  op: "approve" | "decline" | "alternative",
): Promise<WorldState> {
  const store = await getStore();
  const state =
    op === "approve" ? store.approve(id) : op === "decline" ? store.decline(id) : store.alternative(id);
  return world(store, state);
}

export async function syncOffline(
  events: unknown[],
): Promise<{ applied: number; state: WorldState }> {
  // In the v2 engine, edge events are already in the event log; restoring the
  // connection marks them synced. We simply report how many were pending.
  const store = await getStore();
  const before = store.get().pendingSyncCount;
  const state = store.setConnection("cloud");
  return { applied: before, state: world(store, state) };
}

export function publicSummary(state: WorldState) {
  const peopleAffected = state.incident.active
    ? 1248
    : state.requests.reduce((n, r) => n + r.people, 0);
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

export function contract() {
  return {
    service: "Lifeline OS API (engine v2 — Engineer 3 engine)",
    version: "0.2",
    endpoints: [
      "GET /health",
      "GET /state",
      "GET /impact",
      "GET /contract",
      "POST /simulate  { scenario?: earthquake|wildfire|flood|heatwave|grid_failure }",
      "POST /simulate/reset",
      "POST /simulate/road-close",
      "POST /requests  { text }",
      "POST /actions/:id/approve",
      "POST /actions/:id/decline",
      "POST /actions/:id/alternative",
      "POST /connection  { mode: cloud|edge }",
      "POST /sync  { events }",
    ],
  };
}
