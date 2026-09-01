import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const packet = fs.readFileSync(path.join(process.cwd(), "docs", "ops", "p8-production-history-read-only.sql"), "utf8");
const executable = packet.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/'(?:''|[^'])*'/g, "''");
assert.match(executable, /\bSELECT\b/i);
assert.doesNotMatch(executable, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\b/i);
assert.doesNotMatch(packet, /(?:service[_-]?role|anon[_-]?key|password|token)\s*=\s*[^\s]+/i);
console.log("P8_PRODUCTION_HISTORY_PACKET_READ_ONLY_OK");
