import { readFile } from "node:fs/promises";
import { validateLegalLocalRebuildRestoreEvidence } from "../lib/legal-local-rebuild-restore-evidence.mjs";

const [bindingPath, evidencePath] = process.argv.slice(2);
if (!bindingPath || !evidencePath) throw new Error("R6_LOCAL_REBUILD_RESTORE_VALIDATOR_INPUT_REQUIRED");
const [targetBinding, evidence] = await Promise.all([readFile(bindingPath, "utf8").then(JSON.parse), readFile(evidencePath, "utf8").then(JSON.parse)]);
process.stdout.write(`${JSON.stringify(validateLegalLocalRebuildRestoreEvidence(evidence, { targetBinding }))}\n`);
