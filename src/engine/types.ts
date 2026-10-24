/**
 * Lifeline OS — shared engine contract.
 *
 * Frontend (Engineer 1) and backend (Engineer 2) import from here.
 * Everything is plain, JSON-serializable data: no classes, no Dates, no Infinity.
 * Time is always simulated minutes since the disaster scenario started (`simTime`).
 * Distances shown to users are in miles; durations in minutes.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type FacilityType = 'pharmacy' | 'food_bank' | 'grocery' | 'shelter' | 'community_center';
export type PowerSource = 'grid' | 'battery' | 'generator' | 'none';
export type BackupPowerSource = 'battery' | 'generator';
export type FacilityStatus = 'stable' | 'limited' | 'at_risk' | 'critical';
export type ItemKind = 'insulin' | 'medication' | 'meals' | 'water' | 'blankets';
export type Urgency = 'critical' | 'high' | 'medium' | 'low';
export type ClockSeverity = 'critical' | 'at_risk' | 'warning' | 'stable';
export type ClockKind = 'cold_storage' | 'power' | 'supply';
export type VehicleType = 'car' | 'van' | 'bike';
export type ConnectionMode = 'online' | 'edge';
export type DisasterType = 'earthquake' | 'wildfire' | 'flood' | 'heatwave' | 'grid_failure';
export type EventOrigin = 'cloud' | 'edge';

// ---------------------------------------------------------------------------
// Facilities & inventory
// ---------------------------------------------------------------------------

export interface InventoryItem {
  id: string;
  kind: ItemKind;
  quantity: number;
  /** Display unit, e.g. "doses", "meals", "bottles". */
  unit: string;
  requiresColdStorage: boolean;
  /** Units consumed per sim hour (shelters). Omit for stock that isn't being drawn down. */
  consumptionPerHour?: number;
}

export interface Refrigeration {
  working: boolean;
  currentTempC: number;
  maxSafeTempC: number;
  /** How fast the interior warms when not cooling (no power or failed unit). */
  tempRiseRateCPerHour: number;
  /** Extra cold-storage units this facility can accept (used by the matcher). */
  spareCapacityUnits: number;
}

export interface Facility {
  id: string;
  name: string;
  type: FacilityType;
  lat: number;
  lng: number;
  /** True if the facility currently has electricity from any source. */
  hasPower: boolean;
  /** Where the electricity is currently coming from. */
  powerSource: PowerSource;
  /** Backup that takes over when the grid drops, if any. */
  backupSource?: BackupPowerSource;
  /** Hours of backup power left. Only drains while powerSource is battery/generator. */
  batteryHoursRemaining?: number;
  refrigeration: Refrigeration | null;
  inventory: InventoryItem[];
  peopleServed: number;
  /** Derived from the facility's worst survival clock. Recomputed every tick. */
  status: FacilityStatus;
}

// ---------------------------------------------------------------------------
// Volunteers
// ---------------------------------------------------------------------------

export interface Volunteer {
  id: string;
  name: string;
  lat: number;
  lng: number;
  vehicle: VehicleType;
  /** Max units this volunteer can carry in one trip. */
  capacity: number;
  hasCooler: boolean;
  available: boolean;
  currentActionId?: string;
}

// ---------------------------------------------------------------------------
// Needs / requests
// ---------------------------------------------------------------------------

export type RequestStatus = 'open' | 'matched' | 'in_progress' | 'resolved' | 'cancelled';
export type RequestSource = 'resident' | 'facility';

/**
 * A need from a resident or facility.
 * PRIVACY: no names, no medical records, no personal IDs — only what is needed to act.
 */
export interface NeedRequest {
  id: string;
  source: RequestSource;
  rawText?: string;
  needKind: ItemKind;
  quantity: number;
  peopleAffected: number;
  urgency: Urgency;
  /** Elderly, medical dependency, infant, disability, etc. */
  vulnerable: boolean;
  powerAvailable?: boolean;
  lat: number;
  lng: number;
  /** Coarse, human-readable location ("near 4th St & San Fernando"). */
  locationLabel: string;
  /** Sim minutes. */
  createdAt: number;
  status: RequestStatus;
  /** Derived: why an open request has no proposal yet (e.g. every volunteer is booked). */
  waitingReason?: string;
}

// ---------------------------------------------------------------------------
// Survival clocks
// ---------------------------------------------------------------------------

export interface SurvivalClock {
  /** Inventory item id, or `${facilityId}:power` for power clocks, `${itemId}:supply` for supply clocks. */
  resourceId: string;
  facilityId: string;
  kind: ClockKind;
  itemKind?: ItemKind;
  quantityAtRisk?: number;
  unit?: string;
  label: string;
  minutesRemaining: number;
  severity: ClockSeverity;
  cause: string;
}

/** Inventory that crossed its failure point before anyone could save it. Counts against impact. */
export interface LostInventory {
  facilityId: string;
  itemId: string;
  kind: ItemKind;
  quantity: number;
  unit: string;
  simTime: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export interface RoadClosure {
  id: string;
  centerLat: number;
  centerLng: number;
  radiusMiles: number;
  label: string;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** 'reroute' = reassign an at-risk in-progress action to a different volunteer. */
export type ActionType = 'transfer' | 'deliver' | 'reroute';
/** 'cancelled' = an approved action that was superseded by an approved reassignment. */
export type ActionStatus = 'proposed' | 'approved' | 'in_progress' | 'completed' | 'declined' | 'cancelled';

/** Every factor in the priority formula, so the UI can show "why". */
export interface PriorityBreakdown {
  urgency: Urgency;
  urgencyWeight: number;
  peopleAffected: number;
  /** log2(1 + peopleAffected) */
  peopleFactor: number;
  vulnerable: boolean;
  vulnerabilityMultiplier: number;
  minutesRemaining: number;
  /** 60 / max(minutesRemaining, 5) */
  timePressure: number;
  itemKind: ItemKind;
  resourceCriticality: number;
  distanceMiles: number;
  detourPenalty: number;
  numerator: number;
  denominator: number;
}

export interface ActionImpact {
  mealsProtected: number;
  dosesProtected: number;
  peopleHelped: number;
}

/** A candidate the matcher considered and dropped. Shown by "Find Alternative". */
export interface RejectedOption {
  destinationId: string;
  volunteerId?: string;
  reason: string;
}

export interface Action {
  id: string;
  type: ActionType;
  /** The need this action serves (clock resourceId, request id, or `reassign:<actionId>`). */
  needId: string;
  fromFacilityId: string;
  /** Exactly one of toFacilityId / toRequestId is set. */
  toFacilityId?: string;
  toRequestId?: string;
  itemKind: ItemKind;
  quantity: number;
  volunteerId: string;
  distanceMiles: number;
  etaMinutes: number;
  rerouted: boolean;
  /** The time-to-failure (minutes) this action has to beat. */
  deadlineMinutes: number;
  priorityScore: number;
  scoreBreakdown: PriorityBreakdown;
  impact: ActionImpact;
  /** Deterministic template text. Bedrock may replace it with friendlier prose. */
  explanation: string;
  status: ActionStatus;
  alternatives?: Action[];
  rejectedOptions?: RejectedOption[];
  createdAt: number;
  approvedAt?: number;
  /** Absolute sim minute the resource fails (set when approved). */
  deadlineAt?: number;
  /** Absolute sim minute the action will complete: approval + ETA + loading buffer. */
  completesAt?: number;
  completedAt?: number;
  /** In-progress action that will now finish after its deadline (e.g. after a road closure). */
  atRisk?: boolean;
  /** For type 'reroute': the in-progress action this one replaces. */
  replacesActionId?: string;
  declineReason?: string;
  /** Set when the coordinator declined the need itself, not just this volunteer/route. */
  needDismissed?: boolean;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

interface EventBase {
  id: string;
  /** Sim minute the event happened. */
  simTime: number;
  origin: EventOrigin;
  synced: boolean;
}

export type EngineEvent = EventBase &
  (
    | {
        type: 'DISASTER_STARTED';
        disasterType: DisasterType;
        /** Intensity on the disaster's own scale: Mw, AQI, inches of rain, °F, or % of customers without power. */
        magnitude: number;
        label: string;
      }
    | { type: 'POWER_LOST'; facilityId: string }
    | { type: 'REFRIGERATION_FAILED'; facilityId: string }
    | {
        type: 'INVENTORY_CHANGED';
        facilityId: string;
        itemKind: ItemKind;
        /** Positive adds stock, negative removes it. */
        delta: number;
        reason?: string;
      }
    | { type: 'DEMAND_INCREASED'; facilityId: string; additionalPeople: number }
    | { type: 'REQUEST_SUBMITTED'; request: NeedRequest }
    | { type: 'ROAD_CLOSED'; closure: RoadClosure }
    | { type: 'ROAD_REOPENED'; closureId: string }
    | { type: 'ACTION_APPROVED'; actionId: string }
    | {
        type: 'ACTION_DECLINED';
        actionId: string;
        reason?: string;
        /** true: stop proposing anything for this need. false/omitted: only rule out this option. */
        dismissNeed?: boolean;
      }
    | { type: 'ACTION_COMPLETED'; actionId: string }
    | { type: 'CONNECTION_LOST' }
    | { type: 'CONNECTION_RESTORED' }
  );

export type EngineEventType = EngineEvent['type'];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** What callers dispatch; the engine stamps id / simTime / origin / synced. */
export type EngineEventInput = DistributiveOmit<EngineEvent, keyof EventBase>;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface DisasterInfo {
  type: DisasterType;
  magnitude: number;
  label: string;
  startedAt: number;
}

export interface EngineState {
  simTime: number;
  disaster: DisasterInfo | null;
  facilities: Facility[];
  volunteers: Volunteer[];
  requests: NeedRequest[];
  roadClosures: RoadClosure[];
  actions: Action[];
  /** Sorted by minutesRemaining ascending. */
  clocks: SurvivalClock[];
  lostInventory: LostInventory[];
  connection: ConnectionMode;
  pendingSyncCount: number;
  eventLog: EngineEvent[];
}
