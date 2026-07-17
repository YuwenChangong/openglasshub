import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertReviewedPayload,
  REVIEWED_SUPPLEMENTAL_SQL_PATH,
  REVIEWED_SUPPLEMENTAL_SQL_SHA256,
} from "./lib/reviewed-sql-transport.mjs";

const root = process.cwd();
const directory = await mkdtemp(path.join(os.tmpdir(), "openglass-reviewed-sql-transport-"));
const manifestPath = path.join(directory, "manifest.json");
const sourceBytes = await readFile(path.join(root, REVIEWED_SUPPLEMENTAL_SQL_PATH));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

assert.equal(sha256(sourceBytes), REVIEWED_SUPPLEMENTAL_SQL_SHA256, "supplemental packet must use its reviewed raw LF bytes");
assert.equal(sourceBytes.includes(0x0d), false, "supplemental packet must not contain CR bytes");
assert.equal(sourceBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), false, "supplemental packet must not contain a UTF-8 BOM");
assert.equal(sourceBytes.at(-1), 0x0a, "supplemental packet must retain its reviewed final newline");
const byteVariants = [
  Buffer.concat([sourceBytes, Buffer.from(" ")]),
  sourceBytes.subarray(0, -1),
  Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), sourceBytes]),
  Buffer.from(sourceBytes.toString("utf8").replace(/\n/g, "\r\n"), "utf8"),
  Buffer.from(sourceBytes.toString("utf8").replace("READ ONLY", "READ  ONLY"), "utf8"),
];
for (const variant of byteVariants) {
  assert.notEqual(sha256(variant), REVIEWED_SUPPLEMENTAL_SQL_SHA256, "any byte-level packet mutation must change the reviewed fingerprint");
  assert.throws(() => assertReviewedPayload({ sourceBytes, payloadBytes: variant }));
}

try {
  execFileSync(process.execPath, [
    "scripts/prepare-operational-guardrails-authenticated-privilege-supplemental-transport.mjs",
    "--dry-run",
    "--target-identity-fingerprint", "local-docker-normalized-replay",
    "--manifest", manifestPath,
  ], { cwd: root, encoding: "utf8" });
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.deepEqual(Object.keys(manifest).sort(), [
    "dryRunValidation",
    "firstMeaningfulSqlToken",
    "lineEnding",
    "manifestVersion",
    "payloadByteCount",
    "payloadByteForByteMatch",
    "payloadEncoding",
    "payloadSha256",
    "sourceByteCount",
    "sourceFile",
    "sourceSha256",
    "targetIdentityFingerprint",
    "timestamp",
    "transportMethod",
  ]);
  assert.equal(manifest.sourceFile, REVIEWED_SUPPLEMENTAL_SQL_PATH);
  assert.equal(manifest.sourceSha256, REVIEWED_SUPPLEMENTAL_SQL_SHA256);
  assert.equal(manifest.sourceSha256, manifest.payloadSha256);
  assert.equal(manifest.sourceByteCount, manifest.payloadByteCount);
  assert.equal(manifest.transportMethod, "raw-file-bytes-to-database-client-stdin");
  assert.equal(manifest.dryRunValidation, "PASS");
  assert.equal(manifest.firstMeaningfulSqlToken, "BEGIN");
  assert.equal(manifest.payloadByteForByteMatch, true);
  assert.match(manifest.timestamp, /^\d{4}-\d{2}-\d{2}T/);
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log(JSON.stringify({ dryRunManifestValidated: true, productionOperations: 0 }));
