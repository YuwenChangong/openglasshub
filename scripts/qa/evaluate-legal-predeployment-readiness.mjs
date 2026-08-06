import { readFile } from "node:fs/promises";
import { evaluateLegalPredeploymentReadiness } from "../lib/legal-predeployment-readiness.mjs";

const argument = (name) => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1] ?? null; };
const json = async (name) => { const value = argument(name); if (value === null) return null; if (!value) throw new Error("R6_LEGAL_PREDEPLOYMENT_EVIDENCE_INPUT_REQUIRED"); return JSON.parse(await readFile(value, "utf8")); };
const targetBinding = await json("--target-binding");
const rebuildRestoreEvidence = await json("--rebuild-evidence");
const migrationTerminal = await json("--migration-terminal");
const smokeTerminal = await json("--smoke-terminal");
const cleanupTerminal = await json("--cleanup-terminal");
const implementationCommit = argument("--implementation-commit");
process.stdout.write(`${JSON.stringify(evaluateLegalPredeploymentReadiness({ targetBinding, rebuildRestoreEvidence, migrationTerminal, smokeTerminal, cleanupTerminal, implementationCommit }))}\n`);
