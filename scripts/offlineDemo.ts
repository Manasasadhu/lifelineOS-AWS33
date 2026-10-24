/**
 * Edge-mode demo: drop the connection at T+3, keep coordinating locally,
 * restore at T+20, then sync queued events through the mock transport (800 ms each).
 *
 *   npm run offline
 */
import {
  advanceScenario,
  approveAction,
  createEventLog,
  createInitialState,
  createMemoryStorage,
  createSyncManager,
  dispatchEvent,
  markEventsSynced,
  replayEventLog,
  simulateEarthquake,
  type EngineState,
} from '../src/engine';

const DROP_AT = 3;
const RESTORE_AT = 20;

const timeline = simulateEarthquake();
const log = createEventLog({ storage: createMemoryStorage() });
let state: EngineState = createInitialState();

for (let m = 0; m <= RESTORE_AT; m++) {
  state = advanceScenario(state, timeline, m === 0 ? 0 : 1);
  if (m === DROP_AT) {
    state = dispatchEvent(state, { type: 'CONNECTION_LOST' });
    console.log(`T+${m}  📡 CONNECTION_LOST → edge mode (engine keeps running locally)`);
  }
  if (m === RESTORE_AT) {
    state = dispatchEvent(state, { type: 'CONNECTION_RESTORED' });
    console.log(`T+${m}  📡 CONNECTION_RESTORED`);
  }
  const top = state.actions.find((a) => a.status === 'proposed');
  if (top) state = approveAction(state, top.id);
  log.mirror(state.eventLog);
  if (state.connection === 'edge') console.log(`T+${m}  [edge] pending sync: ${state.pendingSyncCount}`);
}

console.log('\nQueued edge events:');
for (const e of state.eventLog.filter((x) => !x.synced)) console.log(`  ${e.id.padEnd(48)} ${e.type}`);

const restored = replayEventLog(log.all(), { untilSimTime: state.simTime });
console.log(`\nReplay check (page reload): ${restored.eventLog.length} events, pending ${restored.pendingSyncCount} — ${restored.pendingSyncCount === state.pendingSyncCount ? 'matches' : 'MISMATCH'}`);

console.log('');
const manager = createSyncManager({ onProgress: (p) => console.log(`  ${p.message}`) });
const result = await manager.sync(state.eventLog);
state = markEventsSynced(state, result.syncedIds);
log.markSynced(result.syncedIds);
console.log(`\nPending after sync: ${state.pendingSyncCount} (log pending: ${log.pending().length})`);

const again = await manager.sync(log.all());
console.log(`Re-sync sent ${again.syncedIds.length} events (idempotent).`);
