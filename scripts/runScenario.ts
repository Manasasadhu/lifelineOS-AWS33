/**
 * Demo-reliability check. Runs the earthquake through the real engine store at
 * 60x (1 sim minute per step), auto-approves the top proposal whenever one appears,
 * drops the connection at T+20, restores it at T+25 (sync via 800 ms mock), and
 * prints a readable timeline plus final impact.
 *
 *   npm run scenario            # 90 sim minutes
 *   npm run scenario -- 180     # custom length
 */
import {
  createEngineStore,
  type Action,
  type EngineEvent,
  type EngineState,
  type ImpactMetrics,
} from '../src/engine';

const END_MINUTES = Number(process.argv[2] ?? 90);
const DROP_AT = 20;
const RESTORE_AT = 25;
const CLOCK_EVERY = 15;

const t = (m: number) => `T+${(Number.isInteger(m) ? String(m) : m.toFixed(1)).padStart(4)}`;

function fmtMinutes(m: number): string {
  const total = Math.max(0, Math.round(m));
  const h = Math.floor(total / 60);
  const min = total % 60;
  return h > 0 ? `${h}h ${String(min).padStart(2, '0')}m` : `${min}m`;
}

function summary(a: Action): string {
  return `${a.type} ${a.quantity} ${a.itemKind} ${a.fromFacilityId} → ${a.toFacilityId ?? a.toRequestId} via ${a.volunteerId}, ${a.distanceMiles.toFixed(1)} mi, ETA ${Math.ceil(a.etaMinutes)} min`;
}

function describe(state: EngineState, e: EngineEvent): string {
  const tag = e.origin === 'edge' ? ' [edge]' : '';
  const action = 'actionId' in e ? state.actions.find((a) => a.id === e.actionId) : undefined;
  switch (e.type) {
    case 'DISASTER_STARTED':
      return `🌎 ${e.label}${tag}`;
    case 'POWER_LOST':
    case 'REFRIGERATION_FAILED':
      return `⚡ ${e.type} ${e.facilityId}${tag}`;
    case 'DEMAND_INCREASED':
      return `👥 DEMAND_INCREASED ${e.facilityId} (+${e.additionalPeople} people)${tag}`;
    case 'REQUEST_SUBMITTED':
      return `📨 REQUEST "${e.request.rawText}" → ${e.request.needKind} ×${e.request.quantity}, ${e.request.urgency}${e.request.vulnerable ? ', vulnerable' : ''}${tag}`;
    case 'ROAD_CLOSED':
      return `🚧 ROAD_CLOSED ${e.closure.label}${tag}`;
    case 'ACTION_APPROVED':
      return `✅ APPROVED ${action ? summary(action) : e.actionId}${tag}`;
    case 'ACTION_COMPLETED':
      return `🏁 COMPLETED ${action ? `${action.quantity} ${action.itemKind} → ${action.toFacilityId ?? action.toRequestId} by ${action.volunteerId}` : e.actionId}${tag}`;
    case 'CONNECTION_LOST':
      return '📡 CONNECTION_LOST → edge mode';
    case 'CONNECTION_RESTORED':
      return `📡 CONNECTION_RESTORED${tag}`;
    default:
      return `${e.type}${tag}`;
  }
}

function printClocks(state: EngineState): void {
  console.log(`         ┌ survival clocks`);
  for (const c of state.clocks.slice(0, 5)) {
    const qty = c.quantityAtRisk !== undefined ? ` (${Math.floor(c.quantityAtRisk)} ${c.unit})` : '';
    console.log(`         │ ${c.severity.toUpperCase().padEnd(8)} ${fmtMinutes(c.minutesRemaining).padStart(7)}  ${c.label}${qty}`);
  }
  console.log(`         └ ${state.facilities.map((f) => `${f.name}: ${f.status}`).join(' | ')}`);
}

function printImpact(i: ImpactMetrics): void {
  const n = (x: number | null, d = 1) => (x === null ? '—' : x.toFixed(d));
  console.log(`\n══════════ ${i.label} (T+${i.simTime}) ══════════`);
  console.log(`  Insulin / cold-med doses protected   ${i.dosesProtected}`);
  console.log(`  Meals rescued from failing storage   ${i.mealsRescued}`);
  console.log(`  Meals delivered to shelters          ${i.mealsDelivered}`);
  console.log(`  Residents assisted                   ${i.residentsAssisted}`);
  console.log(`  Requests resolved                    ${i.requestsResolved}`);
  console.log(`  Avg time to dispatch                 ${n(i.avgResponseMinutes)} min  (manual baseline ${i.baselineResponseMinutes} min, assumed)`);
  console.log(`  Avg time to delivery                 ${n(i.avgDeliveryMinutes)} min`);
  console.log(`  Miles driven / naive depot baseline  ${n(i.actualMiles)} / ${n(i.baselineMiles)}  → ${n(i.milesAvoided)} mi avoided`);
  console.log(`  Critical resources preserved         ${n(i.criticalPreservedPercent, 0)}%`);
  console.log(`  Units lost                           ${i.unitsLost}`);
  console.log('  Assumptions:');
  for (const a of i.assumptions) console.log(`    • ${a}`);
}

const store = createEngineStore();
let printed = 0;
const seenReroutes = new Map<string, string>();

function flush(): void {
  const { engine } = store.getState();
  for (const e of engine.eventLog.slice(printed)) console.log(`${t(e.simTime)}  ${describe(engine, e)}`);
  printed = engine.eventLog.length;
  for (const a of engine.actions) {
    if ((a.status !== 'in_progress' && a.status !== 'approved') || !a.rerouted) continue;
    if (seenReroutes.get(a.id) === a.explanation) continue;
    seenReroutes.set(a.id, a.explanation);
    console.log(`${t(engine.simTime)}  ↪ REROUTED ${a.volunteerId}: ETA now ${Math.ceil(a.etaMinutes)} min, ${a.distanceMiles.toFixed(1)} mi${a.atRisk ? '  ⚠ will miss deadline' : ''}`);
  }
}

console.log('SIMULATION RESULTS — Lifeline OS · M7.0 earthquake · downtown San José (mock data) · 60x\n');

for (let minute = 0; minute <= END_MINUTES; minute++) {
  store.step(minute === 0 ? 0 : 1);
  flush();

  if (minute === DROP_AT) {
    store.goOffline();
    flush();
  }
  if (minute === RESTORE_AT) {
    console.log(`${t(minute)}  [edge] ${store.getState().engine.pendingSyncCount} edge event(s) queued, reconnecting…`);
    let lastMessage = '';
    const unsubscribe = store.subscribe(() => {
      const { sync } = store.getState();
      if (sync.status !== 'idle' && sync.message !== lastMessage) {
        lastMessage = sync.message;
        console.log(`         ${sync.message}`);
      }
    });
    const result = await store.goOnline();
    unsubscribe();
    flush();
    console.log(`${t(minute)}  ☁ synced ${result?.syncedIds.length ?? 0} events, pending now ${store.getState().engine.pendingSyncCount}`);
  }

  const top = store.getState().engine.actions.find((a) => a.status === 'proposed');
  if (top) {
    console.log(`${t(minute)}  💡 PROPOSED (score ${top.priorityScore.toFixed(2)}): ${top.explanation}`);
    // Mark as seen so approval doesn't print as a reroute.
    store.approve(top.id);
    const approved = store.getState().engine.actions.find((a) => a.id === top.id);
    if (approved) seenReroutes.set(approved.id, approved.explanation);
    flush();
  }

  const { engine } = store.getState();
  for (const l of engine.lostInventory) {
    if (l.simTime > minute - 1 && l.simTime <= minute) {
      console.log(`${t(l.simTime)}  ✗ LOST ${l.quantity} ${l.unit} of ${l.kind} at ${l.facilityId}: ${l.reason}`);
    }
  }
  if (minute % CLOCK_EVERY === 0) printClocks(engine);
}

const { engine, impact } = store.getState();
console.log(`\nCompleted actions:`);
for (const a of engine.actions.filter((x) => x.status === 'completed')) {
  console.log(`  ✓ ${t(a.completedAt ?? 0)}  ${summary(a)}`);
}
printImpact(impact);
store.destroy();
