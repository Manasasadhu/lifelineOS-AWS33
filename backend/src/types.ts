export type Severity = "healthy" | "warning" | "at_risk" | "critical";
export type FacilityType =
  | "pharmacy"
  | "food_bank"
  | "grocery"
  | "shelter"
  | "community_center"
  | "volunteer";
export type ActionStatus = "pending" | "approved" | "declined" | "rerouted" | "completed";
export type Urgency = "critical" | "high" | "medium" | "low";

export interface InventoryItem {
  item: string;
  quantity: number;
  unit: string;
  coldChain?: boolean;
  atRisk?: boolean;
}

export interface Facility {
  id: string;
  name: string;
  type: FacilityType;
  status: Severity;
  lat: number;
  lng: number;
  power: boolean;
  refrigerationHoursRemaining: number | null;
  failureAt: string | null;
  inventory: InventoryItem[];
  peopleServed: number;
  available?: boolean;
  /** Volunteers only: available, assigned (on a pending proposal) or busy (on an approved trip). */
  volunteerStatus?: "available" | "assigned" | "busy";
  /** Volunteers only: the trip they are assigned to or driving. */
  task?: string | null;
  notes?: string;
}

export interface Action {
  id: string;
  severity: "critical" | "at_risk" | "warning";
  title: string;
  reason: string;
  fromFacilityId: string;
  toFacilityId: string;
  driverId: string | null;
  item: string;
  quantity: number;
  distanceMiles: number;
  etaMinutes: number;
  coldStorageHoursRemaining: number | null;
  estimatedImpact: string;
  status: ActionStatus;
  /** When the action was first proposed. */
  createdAt: string;
  /** For actions serving a resident request: when that request was submitted. */
  requestedAt?: string;
  explanation?: string;
  excludedDestinationIds?: string[];
}

export interface EmergencyRequest {
  id: string;
  rawText: string;
  need: string;
  urgency: Urgency;
  people: number;
  powerAvailable: boolean | null;
  location: string;
  source: "bedrock" | "rules";
  createdAt: string;
  status: "open" | "matched" | "resolved";
  /** Why an open request has no proposed action yet. */
  waitingReason?: string;
}

export interface Incident {
  active: boolean;
  type: string;
  location: string;
  startedAt: string | null;
  label: string;
  /** One-line description of the disaster, e.g. "Guadalupe River flooding — 4.2 in of rain in 6 hours". */
  description?: string;
  elapsedLabel: string;
  roadClosed: boolean;
  roadName: string | null;
}

export interface Impact {
  mealsRescued: number;
  dosesProtected: number;
  residentsAssisted: number;
  requestsResolved: number;
  milesAvoided: number;
  avgResponseBeforeMin: number;
  avgResponseAfterMin: number;
  resourcesPreservedPct: number;
  simulation: boolean;
}

export interface OfflineEvent {
  eventId: string;
  kind: "request" | "approve" | "decline" | "simulate" | "note";
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface Alert {
  id: string;
  severity: Severity;
  title: string;
  subtitle: string;
  remainingSeconds: number | null;
  facilityId?: string;
}

export interface WorldState {
  version: number;
  connection: "cloud" | "edge";
  incident: Incident;
  facilities: Facility[];
  actions: Action[];
  requests: EmergencyRequest[];
  alerts: Alert[];
  impact: Impact;
  offlineEvents: OfflineEvent[];
  logs: string[];
  /** Past coordinator decisions and completed trips, newest first. */
  history?: ActionHistoryEntry[];
}

export interface ActionHistoryEntry {
  id: string;
  at: string;
  actionId: string;
  name: string;
  decision: "Approved" | "Declined" | "Alternative requested" | "Completed";
  volunteer: string | null;
  detail: string;
}

export interface ParsedRequest {
  need: string;
  urgency: Urgency;
  people: number;
  powerAvailable: boolean | null;
  location: string;
  source: "bedrock" | "rules";
}

export interface RouteEstimate {
  distanceMiles: number;
  etaMinutes: number;
  detour: boolean;
}
