export const ENTITY_WRITE_ORDER = Object.freeze(["definition", "device", "source", "sourceLink", "spec", "evidence", "compatibility"]);
const WRITABLE_OPERATIONS = new Set(["INSERT", "UPDATE"]);

/** Reject destructive, conflicted, blocked, malformed, and out-of-scope plan writes before a transaction can start. */
export function collectApprovedRecoveryWrites(plan, { permittedEntities = ENTITY_WRITE_ORDER } = {}) {
  if (!plan || !Array.isArray(plan.entries)) throw new TypeError("Recovery plan must contain entries");
  if (plan.delete !== "NONE") throw new Error("Recovery plan must declare DELETE=NONE");
  const blockers = plan.entries.filter((entry) => entry?.operation === "BLOCKED");
  if (blockers.length) throw new Error(`BLOCKED_RECOVERY_PLAN blockers=${blockers.length}`);
  const conflicts = plan.entries.filter((entry) => entry?.operation === "CONFLICT");
  if (conflicts.length) throw new Error(`CONFLICT_RECOVERY_PLAN conflicts=${conflicts.length}`);
  const ordered = new Map(ENTITY_WRITE_ORDER.map((entity) => [entity, []]));
  for (const entry of plan.entries) {
    if (!WRITABLE_OPERATIONS.has(entry?.operation)) continue;
    if (!permittedEntities.includes(entry.entity) || !ordered.has(entry.entity)) throw new Error(`Unsupported recovery-plan entity: ${entry.entity}`);
    if (!entry.desired || typeof entry.desired !== "object" || Array.isArray(entry.desired)) throw new Error(`Writable ${entry.entity} entry has no desired row`);
    ordered.get(entry.entity).push(entry);
  }
  return Object.freeze(ENTITY_WRITE_ORDER.flatMap((entity) => ordered.get(entity)));
}

/** Execute the validated Release B write list inside one caller-provided atomic transaction. */
export async function runRecoveryPlanTransaction({ client, writes }) {
  if (!client || typeof client.transaction !== "function") throw new TypeError("Transaction client must implement transaction(work)");
  if (!Array.isArray(writes)) throw new TypeError("Recovery transaction writes are required");
  await client.transaction(async (transaction) => {
    if (!transaction || typeof transaction.upsert !== "function") throw new TypeError("Recovery transaction must implement upsert(entity, row)");
    for (const entry of writes) await transaction.upsert(entry.entity, entry.desired);
  });
}

export function operationCountsForWrites(writes) {
  const operations = Object.fromEntries(ENTITY_WRITE_ORDER.map((entity) => [entity, 0]));
  for (const entry of writes) operations[entry.entity] += 1;
  return Object.freeze(operations);
}
