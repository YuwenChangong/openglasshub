import { readFile } from "node:fs/promises";
import { parseCsv, validatePacketRows } from "./operational-guardrails-preflight-core.mjs";

const path = process.argv[2] ?? "C:\\Users\\1\\Downloads\\operational-guardrails-production-preflight.csv";
const result = validatePacketRows(parseCsv(await readFile(path, "utf8")));
console.log(JSON.stringify(result, null, 2));
