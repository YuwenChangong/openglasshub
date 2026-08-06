import { readFile } from "node:fs/promises";
import { validateLegalLocalMigrationReplayPlan } from "../lib/legal-local-migration-replay-contract.mjs";

const [bindingPath, rebuildPath, planPath] = process.argv.slice(2);
if (!bindingPath || !rebuildPath || !planPath) throw new Error("R6_LOCAL_MIGRATION_REPLAY_VALIDATOR_INPUT_REQUIRED");
const [targetBinding, rebuildRestoreEvidence, plan] = await Promise.all([readFile(bindingPath, "utf8").then(JSON.parse), readFile(rebuildPath, "utf8").then(JSON.parse), readFile(planPath, "utf8").then(JSON.parse)]);
process.stdout.write(`${JSON.stringify(validateLegalLocalMigrationReplayPlan(plan, { targetBinding, rebuildRestoreEvidence }))}\n`);
