import { Alert, Facility, Severity, WorldState } from "../types";

export function remainingSeconds(facility: Facility, now = Date.now()): number | null {
  if (facility.failureAt) {
    return Math.max(0, Math.round((Date.parse(facility.failureAt) - now) / 1000));
  }
  if (facility.refrigerationHoursRemaining != null) {
    return Math.round(facility.refrigerationHoursRemaining * 3600);
  }
  return null;
}

export function remainingHours(facility: Facility, now = Date.now()): number | null {
  const sec = remainingSeconds(facility, now);
  return sec == null ? null : sec / 3600;
}

export function classifyStatus(facility: Facility, now = Date.now()): Severity {
  if (facility.type === "volunteer") {
    return facility.available === false ? "warning" : "healthy";
  }
  const hours = remainingHours(facility, now);
  const hasColdRisk = facility.inventory.some((i) => i.coldChain || i.atRisk);
  if (!facility.power && hasColdRisk && hours != null && hours < 1) return "critical";
  if (!facility.power && hasColdRisk && hours != null && hours < 2) return "at_risk";
  if (facility.type === "shelter" && hours != null && hours < 6 && (facility.inventory[0]?.quantity ?? 0) < 80) {
    return hours < 2 ? "at_risk" : "warning";
  }
  if (hours != null && hours < 1 && hasColdRisk) return "critical";
  if (hours != null && hours < 2 && hasColdRisk) return "at_risk";
  if (hours != null && hours < 6 && hasColdRisk) return "warning";
  if (!facility.power) return "warning";
  return "healthy";
}

export function formatRemaining(seconds: number | null): string {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function incidentElapsed(startedAt: string | null, now = Date.now()): string {
  if (!startedAt) return "00:00:00";
  const sec = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  const h = String(Math.floor(sec / 3600)).padStart(2, "0");
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function refreshDerived(state: WorldState, now = Date.now()): WorldState {
  const facilities = state.facilities.map((f) => {
    const hours = remainingHours(f, now);
    return {
      ...f,
      status: classifyStatus(f, now),
      refrigerationHoursRemaining: hours,
    };
  });

  const alerts: Alert[] = facilities
    .filter((f) => f.type !== "volunteer" && (f.status === "critical" || f.status === "at_risk" || f.status === "warning"))
    .map((f) => ({
      id: `alert-${f.id}`,
      severity: f.status,
      title: f.name,
      subtitle: alertSubtitle(f),
      remainingSeconds: remainingSeconds(f, now),
      facilityId: f.id,
    }))
    .sort((a, b) => (a.remainingSeconds ?? 1e12) - (b.remainingSeconds ?? 1e12));

  const incident = {
    ...state.incident,
    elapsedLabel: incidentElapsed(state.incident.startedAt, now),
  };

  return { ...state, facilities, alerts, incident };
}

function alertSubtitle(f: Facility): string {
  const cold = f.inventory.find((i) => i.coldChain || i.atRisk);
  if (f.id === "pharmacy-a") return "Insulin refrigeration";
  if (f.id === "food-bank-b") return cold ? `${cold.quantity} meals` : "Food refrigeration";
  if (f.id === "shelter-c") return "Shelter food supply";
  if (!f.power) return "Power unavailable";
  return f.notes ?? f.type;
}
