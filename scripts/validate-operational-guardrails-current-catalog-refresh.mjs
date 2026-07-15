import { readFile } from "node:fs/promises";
import { validateCurrentCatalogRefreshRows, parseCsv } from "./operational-guardrails-current-catalog-refresh-core.mjs";

const csvPath = process.argv[2] ?? "C:\\Users\\1\\Downloads\\operational-guardrails-current-catalog-refresh.csv";
console.log(JSON.stringify(validateCurrentCatalogRefreshRows(parseCsv(await readFile(csvPath, "utf8"))), null, 2));
