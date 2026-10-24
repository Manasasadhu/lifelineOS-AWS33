import type { Action, EngineState } from "@lifeline/engine";
import type { VolunteerRow } from "./db";

function placeName(state: EngineState, id: string | undefined): string {
  if (!id) return "unknown";
  const facility = state.facilities.find((f) => f.id === id);
  if (facility) return facility.name;
  const request = state.requests.find((r) => r.id === id);
  return request ? `resident (${request.locationLabel})` : id;
}

export function describeTrip(state: EngineState, a: Action): string {
  return `${a.quantity} ${a.itemKind} · ${placeName(state, a.fromFacilityId)} → ${placeName(state, a.toFacilityId ?? a.toRequestId)}`;
}

/**
 * busy      = on an approved / in-progress trip (the engine marks the volunteer unavailable)
 * assigned  = named on a proposal that is waiting for the coordinator's approval
 * available = free
 */
export function volunteerRows(state: EngineState): VolunteerRow[] {
  return state.volunteers.map((v) => {
    const active = state.actions.find(
      (a) => a.volunteerId === v.id && (a.status === "approved" || a.status === "in_progress"),
    );
    const proposed = state.actions.find((a) => a.volunteerId === v.id && a.status === "proposed");
    const current = active ?? proposed;
    return {
      id: v.id,
      name: v.name,
      status: !v.available || active ? "busy" : proposed ? "assigned" : "available",
      currentActionId: current?.id ?? null,
      task: current ? describeTrip(state, current) : null,
      lat: v.lat,
      lng: v.lng,
    };
  });
}
