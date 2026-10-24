/**
 * Path B store: holds Engineer 3's EngineState in the backend and maps the
 * existing API operations onto her engine. Translation to the public
 * WorldState shape is done by adapter.toWorldState().
 *
 * Time model note: her engine uses simTime (minutes). For the live demo we
 * advance the scenario a few minutes so survival clocks are visibly ticking,
 * then the frontend counts down in wall-clock seconds from failureAt.
 */
import {
  advanceScenario,
  approveAction,
  buildRequest,
  createInitialState,
  declineAction,
  dispatchEvent,
  findProposal,
  requestAlternative,
  simulateEarthquake,
  tick,
  type EngineState,
  type NeedRequest,
  type ParsedRequest,
  type ScheduledEvent,
} from "@lifeline/engine";

/** How far into the scenario a fresh /simulate advances (sim minutes). */
const SIMULATE_ADVANCE_MINUTES = 5;

export class EngineV2Store {
  private state: EngineState = createInitialState();
  private timeline: ScheduledEvent[] = simulateEarthquake();

  get(): EngineState {
    return this.state;
  }

  reset(): EngineState {
    this.state = createInitialState();
    this.timeline = simulateEarthquake();
    return this.state;
  }

  /** Apply the scripted earthquake and advance a few minutes so clocks are live. */
  simulate(): EngineState {
    this.timeline = simulateEarthquake();
    this.state = advanceScenario(createInitialState(), this.timeline, SIMULATE_ADVANCE_MINUTES);
    return this.state;
  }

  /** Advance further into the scripted scenario (e.g. to trigger the road closure at T+6). */
  advance(minutes: number): EngineState {
    this.state = advanceScenario(this.state, this.timeline, minutes);
    return this.state;
  }

  /** Submit a natural-language request. `bedrock` is an optional ParsedRequest from the Lambda. */
  submitRequest(text: string, bedrock?: unknown): { state: EngineState; parsed: ParsedRequest; request: NeedRequest | null } {
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
    return { state: this.state, parsed, request };
  }

  approve(actionId: string): EngineState {
    this.requireProposal(actionId);
    this.state = approveAction(this.state, actionId);
    // tick() (not advanceScenario) runs the completion loop so the trip
    // finishes and impact updates. Advance past the action's completesAt.
    this.state = tick(this.state, 20);
    return this.state;
  }

  decline(actionId: string): EngineState {
    this.requireProposal(actionId);
    this.state = declineAction(this.state, actionId);
    return this.state;
  }

  alternative(actionId: string): EngineState {
    this.requireProposal(actionId);
    this.state = requestAlternative(this.state, actionId);
    return this.state;
  }

  /** Throw a 404-style error when the action id is not a current proposal. */
  private requireProposal(actionId: string): void {
    if (!findProposal(this.state, actionId)) {
      const err = new Error("Action not found") as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }
  }

  setConnection(mode: "cloud" | "edge"): EngineState {
    this.state = dispatchEvent(this.state, {
      type: mode === "edge" ? "CONNECTION_LOST" : "CONNECTION_RESTORED",
    });
    return this.state;
  }
}

let singleton: EngineV2Store | undefined;

export function getEngineV2Store(): EngineV2Store {
  if (!singleton) singleton = new EngineV2Store();
  return singleton;
}
