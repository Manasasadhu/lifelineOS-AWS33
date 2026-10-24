/**
 * Resource Survival Clocks: how many sim minutes until each critical resource fails.
 *
 * Three clock kinds:
 *  - cold_storage: minutes until the fridge interior passes maxSafeTempC.
 *  - power:        minutes of battery/generator left while the grid is down.
 *  - supply:       minutes until a consumed stock (e.g. shelter meals) runs out.
 */
import type {
  ClockSeverity,
  EngineState,
  Facility,
  FacilityStatus,
  InventoryItem,
  ItemKind,
  LostInventory,
  Refrigeration,
  SurvivalClock,
} from './types';

export const CLOCK_THRESHOLDS = {
  critical: 60,
  atRisk: 180,
  warning: 480,
} as const;

/** Largest sim step used when advancing physics, so events like "battery died mid-tick" stay accurate. */
export const MAX_SUBSTEP_MINUTES = 1;

const EPSILON = 1e-9;

export const ITEM_LABELS: Record<ItemKind, string> = {
  insulin: 'Insulin',
  medication: 'Cold medication',
  meals: 'Meals',
  water: 'Water',
  blankets: 'Blankets',
};

export function severityFor(minutesRemaining: number): ClockSeverity {
  if (minutesRemaining < CLOCK_THRESHOLDS.critical) return 'critical';
  if (minutesRemaining < CLOCK_THRESHOLDS.atRisk) return 'at_risk';
  if (minutesRemaining < CLOCK_THRESHOLDS.warning) return 'warning';
  return 'stable';
}

export function isOnBackupPower(f: Facility): boolean {
  return f.powerSource === 'battery' || f.powerSource === 'generator';
}

/** Minutes of backup power left, or null if the facility isn't running on backup. */
export function backupMinutesRemaining(f: Facility): number | null {
  if (!isOnBackupPower(f)) return null;
  return Math.max(0, (f.batteryHoursRemaining ?? 0) * 60);
}

export function isCooling(f: Facility): boolean {
  return f.refrigeration !== null && f.refrigeration.working && f.hasPower;
}

/** Minutes until the interior passes its safe limit if cooling stopped right now. */
export function thermalMinutesRemaining(r: Refrigeration): number {
  const margin = r.maxSafeTempC - r.currentTempC;
  if (margin <= EPSILON) return 0;
  if (r.tempRiseRateCPerHour <= 0) return Number.POSITIVE_INFINITY;
  return (margin / r.tempRiseRateCPerHour) * 60;
}

/**
 * Minutes until cold storage at this facility becomes unsafe.
 * null = no countdown (grid-powered and working, or no refrigeration).
 */
export function coldStorageMinutesRemaining(f: Facility): number | null {
  const r = f.refrigeration;
  if (!r) return null;
  if (!isCooling(f)) return thermalMinutesRemaining(r);
  const backup = backupMinutesRemaining(f);
  if (backup === null) return null;
  // On backup: fridge keeps working until power runs out, then starts warming.
  return backup + thermalMinutesRemaining(r);
}

export function supplyMinutesRemaining(item: InventoryItem): number | null {
  if (!item.consumptionPerHour || item.consumptionPerHour <= 0) return null;
  return (Math.max(0, item.quantity) / item.consumptionPerHour) * 60;
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits);
}

function coldCause(f: Facility): string {
  const r = f.refrigeration as Refrigeration;
  const temps = `${fmt(r.currentTempC)}°C now, unsafe above ${fmt(r.maxSafeTempC)}°C`;
  if (!r.working) {
    return `Refrigeration failed; warming ${fmt(r.tempRiseRateCPerHour)}°C/h (${temps})`;
  }
  if (!f.hasPower) {
    return `No power; refrigeration offline, warming ${fmt(r.tempRiseRateCPerHour)}°C/h (${temps})`;
  }
  const hours = (f.batteryHoursRemaining ?? 0).toFixed(1);
  return `Grid down; refrigeration on ${f.powerSource} with ${hours}h left (${temps})`;
}

export function computeFacilityClocks(f: Facility): SurvivalClock[] {
  const clocks: SurvivalClock[] = [];

  const coldMinutes = coldStorageMinutesRemaining(f);
  if (coldMinutes !== null && Number.isFinite(coldMinutes)) {
    for (const item of f.inventory) {
      if (!item.requiresColdStorage || item.quantity <= 0) continue;
      clocks.push({
        resourceId: item.id,
        facilityId: f.id,
        kind: 'cold_storage',
        itemKind: item.kind,
        quantityAtRisk: item.quantity,
        unit: item.unit,
        label: `${f.name} · ${ITEM_LABELS[item.kind]} cold storage`,
        minutesRemaining: coldMinutes,
        severity: severityFor(coldMinutes),
        cause: coldCause(f),
      });
    }
  }

  const backupMinutes = backupMinutesRemaining(f);
  if (backupMinutes !== null) {
    clocks.push({
      resourceId: `${f.id}:power`,
      facilityId: f.id,
      kind: 'power',
      label: `${f.name} · ${f.powerSource === 'generator' ? 'Generator' : 'Battery'} power`,
      minutesRemaining: backupMinutes,
      severity: severityFor(backupMinutes),
      cause: `Grid down; ${f.powerSource} has ${fmt(backupMinutes / 60)}h left`,
    });
  }

  for (const item of f.inventory) {
    const minutes = supplyMinutesRemaining(item);
    if (minutes === null) continue;
    clocks.push({
      resourceId: `${item.id}:supply`,
      facilityId: f.id,
      kind: 'supply',
      itemKind: item.kind,
      quantityAtRisk: item.quantity,
      unit: item.unit,
      label: `${f.name} · ${ITEM_LABELS[item.kind]} supply`,
      minutesRemaining: minutes,
      severity: severityFor(minutes),
      cause: `${Math.floor(item.quantity)} ${item.unit} left, using ${fmt(item.consumptionPerHour ?? 0)}/h for ${f.peopleServed} people`,
    });
  }

  return clocks;
}

/** All clocks, most urgent first. Ties break on resourceId so ordering is deterministic. */
export function computeClocks(state: Pick<EngineState, 'facilities'>): SurvivalClock[] {
  return state.facilities
    .flatMap(computeFacilityClocks)
    .sort((a, b) => a.minutesRemaining - b.minutesRemaining || a.resourceId.localeCompare(b.resourceId));
}

const STATUS_RANK: Record<FacilityStatus, number> = { stable: 0, limited: 1, at_risk: 2, critical: 3 };

const SEVERITY_TO_STATUS: Record<ClockSeverity, FacilityStatus> = {
  critical: 'critical',
  at_risk: 'at_risk',
  warning: 'limited',
  stable: 'stable',
};

/**
 * Status = worst clock at this facility. A facility that has no power or broken
 * refrigeration is at least 'limited' even once nothing is left to count down.
 */
export function facilityStatusFromClocks(f: Facility, facilityClocks: SurvivalClock[]): FacilityStatus {
  let status: FacilityStatus = 'stable';
  for (const clock of facilityClocks) {
    const s = SEVERITY_TO_STATUS[clock.severity];
    if (STATUS_RANK[s] > STATUS_RANK[status]) status = s;
  }
  const degraded = !f.hasPower || (f.refrigeration !== null && !f.refrigeration.working);
  if (degraded && STATUS_RANK[status] < STATUS_RANK.limited) status = 'limited';
  return status;
}

// ---------------------------------------------------------------------------
// Physics: advancing time
// ---------------------------------------------------------------------------

function stepFacility(f: Facility, minutes: number, stepEndTime: number, losses: LostInventory[]): void {
  const hours = minutes / 60;
  let unpoweredHours = f.hasPower ? 0 : hours;

  if (isOnBackupPower(f)) {
    const before = Math.max(0, f.batteryHoursRemaining ?? 0);
    if (before <= hours + EPSILON) {
      f.batteryHoursRemaining = 0;
      f.hasPower = false;
      f.powerSource = 'none';
      unpoweredHours = hours - before;
    } else {
      f.batteryHoursRemaining = before - hours;
    }
  }

  const r = f.refrigeration;
  if (r) {
    const warmingHours = r.working ? unpoweredHours : hours;
    r.currentTempC += r.tempRiseRateCPerHour * warmingHours;

    if (r.currentTempC >= r.maxSafeTempC - EPSILON) {
      for (const item of f.inventory) {
        if (!item.requiresColdStorage || item.quantity <= 0) continue;
        losses.push({
          facilityId: f.id,
          itemId: item.id,
          kind: item.kind,
          quantity: item.quantity,
          unit: item.unit,
          simTime: stepEndTime,
          reason: `Cold storage exceeded ${fmt(r.maxSafeTempC)}°C`,
        });
        item.quantity = 0;
      }
    }
  }

  for (const item of f.inventory) {
    if (item.consumptionPerHour && item.consumptionPerHour > 0) {
      item.quantity = Math.max(0, item.quantity - item.consumptionPerHour * hours);
    }
  }
}

/**
 * Advance temperatures, backup power and consumption by dtMinutes of sim time.
 * Returns new facility objects (inputs are not mutated) plus any inventory lost.
 */
export function advanceFacilities(
  facilities: Facility[],
  dtMinutes: number,
  startTime: number,
): { facilities: Facility[]; losses: LostInventory[] } {
  const next = structuredClone(facilities);
  const losses: LostInventory[] = [];
  let elapsed = 0;
  while (dtMinutes - elapsed > EPSILON) {
    const step = Math.min(MAX_SUBSTEP_MINUTES, dtMinutes - elapsed);
    elapsed += step;
    for (const f of next) stepFacility(f, step, startTime + elapsed, losses);
  }
  return { facilities: next, losses };
}
