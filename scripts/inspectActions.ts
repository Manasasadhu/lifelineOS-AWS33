/**
 * Prints proposed actions with score breakdowns, alternatives and rejected options.
 *
 *   npm run actions            # at T+0
 *   npm run actions -- 20      # after 20 sim minutes
 */
import { advanceScenario, createInitialState, simulateEarthquake, type Action } from '../src/engine';

const atMinute = Number(process.argv[2] ?? 0);
const state = advanceScenario(createInitialState(), simulateEarthquake(), atMinute);

const fmt = (n: number, d = 2) => n.toFixed(d);

function line(a: Action, indent = ''): string {
  return `${indent}${a.volunteerId} ${a.fromFacilityId} → ${a.toFacilityId ?? a.toRequestId}  ${fmt(a.distanceMiles, 1)} mi, ETA ${Math.ceil(a.etaMinutes)} min, score ${fmt(a.priorityScore)}${a.rerouted ? ' [REROUTED]' : ''}`;
}

console.log(`SIMULATION — proposed actions at T+${state.simTime}\n`);
for (const a of state.actions.filter((x) => x.status === 'proposed')) {
  const b = a.scoreBreakdown;
  console.log(`▶ ${a.type.toUpperCase()} ${a.quantity} ${a.itemKind}  (${a.id})`);
  console.log(`  ${line(a)}`);
  console.log(`  "${a.explanation}"`);
  console.log(
    `  why: urgency ${b.urgency}=${b.urgencyWeight} × log2(1+${b.peopleAffected})=${fmt(b.peopleFactor)} × vuln ${b.vulnerabilityMultiplier}` +
      ` × time 60/${fmt(b.minutesRemaining, 0)}=${fmt(b.timePressure)} × ${b.itemKind} ${b.resourceCriticality}` +
      ` = ${fmt(b.numerator)}  ÷ (1 + ${fmt(b.distanceMiles)} mi + ${fmt(b.detourPenalty)} detour) = ${fmt(a.priorityScore)}`,
  );
  console.log(`  impact: ${a.impact.dosesProtected} doses, ${a.impact.mealsProtected} meals, ${a.impact.peopleHelped} people`);
  for (const alt of a.alternatives ?? []) console.log(`  alt: ${line(alt)}`);
  for (const r of a.rejectedOptions ?? []) console.log(`  ✗ ${r.volunteerId ?? '-'} → ${r.destinationId}: ${r.reason}`);
  console.log('');
}
