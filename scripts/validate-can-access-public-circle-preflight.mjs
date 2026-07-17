import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCsv, validatePacketRows } from "./can-access-public-circle-preflight-one-shot-core.mjs";

const expectedFilename = "can-access-public-circle-preflight.csv";
const input = process.argv[2] ?? path.join(process.env.USERPROFILE ?? "C:\\Users\\1", "Downloads", expectedFilename);
assert.equal(path.basename(input), expectedFilename, `provide exactly one CSV named ${expectedFilename}`);
assert.equal(path.extname(input).toLowerCase(), ".csv", "preflight evidence must be a CSV file");

const rows = parseCsv(await readFile(input, "utf8"));
const result = validatePacketRows(rows);
console.log(JSON.stringify({ input: path.basename(input), ...result }));
