import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCsv, validatePacketRows } from "./circles-visibility-preflight-core.mjs";

const expectedFilename = "circles-visibility-production-preflight.csv";
const input = process.argv[2] ?? path.join(process.env.USERPROFILE ?? "C:\\Users\\1", "Downloads", expectedFilename);
assert.equal(path.basename(input), expectedFilename, `provide exactly one CSV named ${expectedFilename}`);
assert.equal(path.extname(input).toLowerCase(), ".csv", "preflight evidence must be a CSV file");

const result = validatePacketRows(parseCsv(await readFile(input, "utf8")));
console.log(JSON.stringify({ input: path.basename(input), ...result }));
