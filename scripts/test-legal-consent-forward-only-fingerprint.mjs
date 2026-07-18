import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const record = JSON.parse(await readFile("docs/ops/reconciliation/legal-consent-forward-only-fingerprint-v1.json", "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
for (const [file, value] of Object.entries(record.artifacts)) {
  const expected = typeof value === "string" ? value : value.sha256;
  const requiredEol = typeof value === "string" ? "LF" : value.eol;
  const bytes = await readFile(file);
  assert.equal(hash(bytes), expected, `${file}: immutable fingerprint mismatch`);
  assert.equal(bytes.includes(0x0d), requiredEol === "CRLF", `${file}: unexpected line ending contract`);
  assert.equal(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), false, `${file}: BOM is forbidden`);
  assert.equal(bytes.at(-1), 0x0a, `${file}: final LF is required`);
  for (const variant of [Buffer.concat([bytes, Buffer.from(" ")]), bytes.subarray(0, -1), Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),bytes]), Buffer.from(bytes.toString("utf8").replace(/\n/g,"\r\n")), Buffer.concat([bytes.subarray(0,1),Buffer.from([bytes[1]^1]),bytes.subarray(2)])]) assert.notEqual(hash(variant), expected, `${file}: byte mutation must fail`);
}
console.log(JSON.stringify({status:"PASS",artifacts:Object.keys(record.artifacts).length,rawByteChecks:true}));
