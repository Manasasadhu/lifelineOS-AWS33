/**
 * Path B store: holds Engineer 3's EngineState in the backend and maps the
 * existing API operations onto her engine. Translation to the public
 * WorldState shape is done by adapter.toWorldState().
 *
 * Time model: once a disaster is running, sim time follows the wall clock
 * (SIM_SPEED sim minutes per real minute, default 1), so approved trips take
 * their real ETA, volunteers stay busy until they arrive, and scheduled events
 * such as the T+6 road closure fire on their own. The clock pauses while the
 * server is down.
 *
 * Persistence: when LIFELINE_DB is set, every change is saved to SQLite and
 * reloaded on start-up (see db.ts).
 */
import {
  advanceScenario,
  approveAction,
  buildRequest,
  buildScenario,
  createInitialState,
  declineAction,
  dispatchEvent,
  findProposal,
  isDisasterType,
  requestAlternative,
  type Action,
  type DisasterType,
  type EngineState,
  type NeedRequest,
  type ParsedRequest,
  type ScheduledEvent,
} from "@lifeline/engine";
import { simSpeed } from "./clock";
import { EngineDb, type HistoryEntry, type Snapshot, type VolunteerRow } from "./db";
import { DynamoEngineDb } from "./dynamo";
import { describeTrip, volunteerRows } from "./volunteers";

/** Persistence contract shared by the SQLite (local) and DynamoDB (cloud) stores. */
export interface PersistenceDb {
  load(): Snapshot | null;
  save(scenario: string, state: EngineState, history: HistoryEntry[], volunteers: VolunteerRow[], stamps: Record<string, string>): void;
  clear(): void;
}

/** How far into the scenario a fresh /simulate advances (sim minutes). */
const SIMULATE_ADVANCE_MINUTES = 5;

const HISTORY_DETAIL: Record<HistoryEntry["decision"], string> = {
  Approved: "Volunteer dispatched",
  Declined: "Need dismissed; escalated for manual follow-up",
  "Alternative requested": "Looking for a different option",
  Completed: "Delivered",
};

export class EngineV2Store {
  private state: EngineState = createInitialState();
  private scenario: DisasterType = "earthquake";
  private timeline: ScheduledEvent[] = buildScenario("earthquake");
  private history: HistoryEntry[] = [];
  private stamps: Record<string, string> = {};
  private lastWallMs = Date.now();
  readonly speed = simSpeed();

  constructor(private readonly db?: PersistenceDb) {
    const saved = db?.load();
    if (saved && isDisasterType(saved.scenario)) {
      this.scenario = saved.scenario;
      this.timeline = buildScenario(saved.scenario);
      this.state = saved.state;
      this.history = saved.history;
      this.stamps = saved.stamps;
    }
  }

  get(): EngineState {
    this.syncClock();
    return this.state;
  }

  getHistory(): HistoryEntry[] {
    return this.history;
  }

  /** Wall-clock ISO time each request / action id was first seen. */
  getStamps(): Record<string, string> {
    return this.stamps;
  }

  reset(): EngineState {
    this.state = createInitialState();
    this.scenario = "earthquake";
    this.timeline = buildScenario("earthquake");
    this.history = [];
    this.stamps = {};
    this.db?.clear();
    return this.commit();
  }

  /** Start a scripted disaster (earthquake by default) and advance a few minutes so clocks are live. */
  simulate(scenario: string = "earthquake"): EngineState {
    if (!isDisasterType(scenario)) {
      const err = new Error(`Unknown scenario "${scenario}"`) as Error & { statusCode: number };
      err.statusCode = 400;
      throw err;
    }
    this.scenario = scenario;
    this.timeline = buildScenario(scenario);
    this.history = [];
    this.stamps = {};
    this.db?.clear();
    this.state = advanceScenario(createInitialState(), this.timeline, SIMULATE_ADVANCE_MINUTES);
    return this.commit();
  }

  /** Advance further into the scripted scenario (e.g. to trigger the road closure at T+6). */
  advance(minutes: number): EngineState {
    this.syncClock();
    this.state = this.trackCompletions(advanceScenario(this.state, this.timeline, minutes));
    return this.commit();
  }

  /** Submit a natural-language request. `bedrock` is an optional ParsedRequest from the Lambda. */
  submitRequest(text: string, bedrock?: unknown): { state: EngineState; parsed: ParsedRequest; request: NeedRequest | null } {
    this.syncClock();
    const seq = this.state.requests.length + 1;
    const { request, parsed } = buildRequest({
      id: `req-${String(seq).padStart(4, "0")}`,
      text,
      bedrock,
      lat: 37.3425,
      lng: -121.8795,
      locationLabel: "Downtown San José",
      createdAt: this.state.simTime,
    });
    if (request) {
      this.state = dispatchEvent(this.state, { type: "REQUEST_SUBMITTED", request });
    }
    return { state: this.commit(), parsed, request };
  }

  approve(actionId: string): EngineState {
    const action = this.requireProposal(actionId);
    this.state = approveAction(this.state, actionId);
    this.record(action, "Approved");
    return this.commit();
  }

  decline(actionId: string): EngineState {
    const action = this.requireProposal(actionId);
    this.state = declineAction(this.state, actionId);
    this.record(action, "Declined");
    return this.commit();
  }

  alternative(actionId: string): EngineState {
    const action = this.requireProposal(actionId);
    this.state = requestAlternative(this.state, actionId);
    this.record(action, "Alternative requested");
    return this.commit();
  }

  setConnection(mode: "cloud" | "edge"): EngineState {
    this.syncClock();
    this.state = dispatchEvent(this.state, {
      type: mode === "edge" ? "CONNECTION_LOST" : "CONNECTION_RESTORED",
    });
    return this.commit();
  }

  /** Throw a 404-style error when the action id is not a current proposal. */
  private requireProposal(actionId: string): Action {
    this.syncClock();
    const action = findProposal(this.state, actionId);
    if (!action) {
      const err = new Error("Action not found") as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }
    return action;
  }

  /** Move sim time forward by the wall-clock time since the last call. */
  private syncClock(): void {
    const now = Date.now();
    const dtMinutes = ((now - this.lastWallMs) / 60_000) * this.speed;
    this.lastWallMs = now;
    if (!this.state.disaster || dtMinutes <= 0) return;
    const before = this.state;
    this.state = this.trackCompletions(advanceScenario(this.state, this.timeline, dtMinutes));
    if (this.state !== before) this.persist();
  }

  /** Add a history entry for every trip that finished since the last state. */
  private trackCompletions(next: EngineState): EngineState {
    const done = new Set(this.state.actions.filter((a) => a.status === "completed").map((a) => a.id));
    for (const a of next.actions) {
      if (a.status === "completed" && !done.has(a.id)) this.record(a, "Completed", next);
    }
    return next;
  }

  private record(action: Action, decision: HistoryEntry["decision"], state: EngineState = this.state): void {
    const volunteer = state.volunteers.find((v) => v.id === action.volunteerId)?.name ?? null;
    this.history.push({
      id: `${action.id}#${decision}#${this.history.length}`,
      at: new Date().toISOString(),
      actionId: action.id,
      name: describeTrip(state, action),
      decision,
      volunteer,
      detail: HISTORY_DETAIL[decision],
    });
  }

  private commit(): EngineState {
    this.lastWallMs = Date.now();
    this.persist();
    return this.state;
  }

  private persist(): void {
    const now = new Date().toISOString();
    for (const { id } of [...this.state.requests, ...this.state.actions]) this.stamps[id] ??= now;
    this.db?.save(this.scenario, this.state, this.history, volunteerRows(this.state), this.stamps);
  }
}

let singleton: EngineV2Store | undefined;
let initPromise: Promise<EngineV2Store> | undefined;

/**
 * Synchronous accessor. Safe to call anywhere, but with DynamoDB persistence the
 * first call may not yet have the saved snapshot loaded — prefer getStore() in
 * request handlers so the cloud snapshot is read first.
 */
export function getEngineV2Store(): EngineV2Store {
  if (!singleton) {
    const table = process.env.TABLE_NAME;
    const file = process.env.LIFELINE_DB;
    if (table) {
      singleton = new EngineV2Store(new DynamoEngineDb(table));
    } else {
      singleton = new EngineV2Store(file && file !== "off" ? new EngineDb(file) : undefined);
    }
  }
  return singleton;
}

/**
 * Async accessor used by request handlers. When DynamoDB persistence is active,
 * it reads the saved snapshot once and rebuilds the store from it before first use.
 */
export async function getStore(): Promise<EngineV2Store> {
  const table = process.env.TABLE_NAME;
  if (!table) return getEngineV2Store(); // SQLite / in-memory need no async load

  if (!initPromise) {
    initPromise = (async () => {
      const db = new DynamoEngineDb(table);
      await db.loadAsync(); // populate the sync cache from DynamoDB
      singleton = new EngineV2Store(db);
      return singleton;
    })();
  }
  return initPromise;
}
