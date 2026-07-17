import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const directory = await mkdtemp(path.join(os.tmpdir(), "openglass-reviewed-sql-transport-"));
const manifestPath = path.join(directory, "manifest.json");

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
  assert.equal(manifest.sourceFile, "docs/ops/reconciliation/operational-guardrails-authenticated-privilege-supplemental-preflight.sql");
  assert.equal(manifest.sourceSha256, "d96e76f9dd3655c03a64dc5d535087fc63f99370b13b246f6529caaf121cd074");
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
