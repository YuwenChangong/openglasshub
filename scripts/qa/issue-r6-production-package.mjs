import { readFile } from "node:fs/promises";
import path from "node:path";
import { issueProductionReconciliationV3Package } from "../lib/r6-production-reconciliation-package-builder.mjs";

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== "--config" || args[2] !== "--package-root") throw new Error("R6_PRODUCTION_RECONCILIATION_PACKAGE_ISSUE_INPUT_INVALID");
const config = JSON.parse(await readFile(path.resolve(args[1]), "utf8"));
const result = await issueProductionReconciliationV3Package({ ...config, packageRoot: path.resolve(args[3]) });
process.stdout.write(`${JSON.stringify({ classification: "R6_PRODUCTION_RECONCILIATION_V3_PACKAGE_ISSUED_OFFLINE", ...result })}\n`);
