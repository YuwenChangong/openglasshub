import { REQUIRED_FORWARD_MIGRATION_FILES } from "./legal-consent-forward-migration-inventory.mjs";
import { validateLegalNonproductionTargetBinding, LOCAL_NONPRODUCTION_TARGET_CLASS } from "./legal-nonproduction-target-binding.mjs";
import { validateLegalLocalRebuildRestoreEvidence } from "./legal-local-rebuild-restore-evidence.mjs";

export const LEGAL_LOCAL_MIGRATION_REPLAY_SCHEMA = "legal-local-nonproduction-migration-replay-plan-v1";
const fail = (code) => { throw Object.assign(new Error(code), { code }); };

export function createLegalLocalMigrationReplayPlan({ targetBindingSha256, rebuildRestoreEvidenceSha256 }) {
  return Object.freeze({
    schemaVersion: LEGAL_LOCAL_MIGRATION_REPLAY_SCHEMA,
    targetBindingSha256,
    rebuildRestoreEvidenceSha256,
    migrations: Object.freeze(REQUIRED_FORWARD_MIGRATION_FILES.map((file, index) => Object.freeze({ sequence: index + 1, file, attempts: 1, retryCount: 0, automaticRollback: false }))),
    executionAuthorized: false,
  });
}

export function validateLegalLocalMigrationReplayPlan(plan, { targetBinding, rebuildRestoreEvidence, now = Date.now() } = {}) {
  const target = validateLegalNonproductionTargetBinding(targetBinding, { now });
  if (target.providerClass !== LOCAL_NONPRODUCTION_TARGET_CLASS) fail("R6_LOCAL_MIGRATION_REPLAY_TARGET_CLASS_INVALID");
  validateLegalLocalRebuildRestoreEvidence(rebuildRestoreEvidence, { targetBinding, now });
  if (!plan || plan.schemaVersion !== LEGAL_LOCAL_MIGRATION_REPLAY_SCHEMA || plan.executionAuthorized !== false) fail("R6_LOCAL_MIGRATION_REPLAY_PLAN_INVALID");
  if (!Array.isArray(plan.migrations) || plan.migrations.length !== REQUIRED_FORWARD_MIGRATION_FILES.length) fail("R6_LOCAL_MIGRATION_REPLAY_INVENTORY_INVALID");
  for (const [index, expectedFile] of REQUIRED_FORWARD_MIGRATION_FILES.entries()) {
    const migration = plan.migrations[index];
    if (!migration || migration.sequence !== index + 1 || migration.file !== expectedFile || migration.attempts !== 1 || migration.retryCount !== 0 || migration.automaticRollback !== false) fail(`R6_LOCAL_MIGRATION_REPLAY_ORDER_OR_RETRY_INVALID:${index + 1}`);
  }
  return Object.freeze({ classification: "R6_LOCAL_NONPRODUCTION_MIGRATION_REPLAY_CONTRACT_READY", migrationCount: REQUIRED_FORWARD_MIGRATION_FILES.length, executionAuthorized: false });
}
