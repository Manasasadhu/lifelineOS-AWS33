import { getState, mutateAction, publicSummary, simulateDisaster, submitRequest } from "./service";
import { resetStoreForTests } from "./store";

async function main() {
  resetStoreForTests();
  const sim = publicSummary(await simulateDisaster());
  console.log("incident", sim.incident.label);
  console.log(
    "clocks",
    sim.priorityQueue.map((q) => `${q.title} ${q.remainingSeconds}s`),
  );
  console.log(
    "actions",
    sim.actions.map((a) => `${a.status} ${a.title} ${a.quantity} ${a.item} → ${a.toFacilityId}`),
  );

  const { parsed, state } = await submitRequest("My grandmother needs insulin and our power went out.");
  console.log("parsed", parsed);

  const pending = state.actions.find((a) => a.status === "pending");
  if (!pending) throw new Error("expected a pending action");
  const approved = publicSummary(await mutateAction(pending.id, "approve"));
  console.log("impact", approved.impact);

  const after = publicSummary(await getState());
  if (!after.incident.active) throw new Error("incident should be active");
  if (after.impact.dosesProtected < 1 && after.impact.mealsRescued < 1) {
    throw new Error("expected impact after approval");
  }
  console.log("smoke ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
