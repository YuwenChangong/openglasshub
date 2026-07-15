import { readFile } from "node:fs/promises";
import { parseCsv, validateSupplementalRows } from "./operational-guardrails-supplemental-preflight-core.mjs";
const csvPath = process.argv[2] ?? "C:\\Users\\1\\Downloads\\operational-guardrails-production-preflight-supplemental.csv";
console.log(JSON.stringify(validateSupplementalRows(parseCsv(await readFile(csvPath, "utf8"))), null, 2));
