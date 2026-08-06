import { readFile } from "node:fs/promises";
import { evaluateLegalPredeploymentReadiness } from "../lib/legal-predeployment-readiness.mjs";

const index = process.argv.indexOf("--target-binding");
const targetBindingPath = index < 0 ? null : process.argv[index + 1] ?? null;
if (index >= 0 && !targetBindingPath) throw new Error("R6_LEGAL_PREDEPLOYMENT_TARGET_BINDING_INPUT_REQUIRED");
const targetBinding = targetBindingPath ? JSON.parse(await readFile(targetBindingPath, "utf8")) : null;
process.stdout.write(`${JSON.stringify(evaluateLegalPredeploymentReadiness({ targetBinding }))}\n`);
