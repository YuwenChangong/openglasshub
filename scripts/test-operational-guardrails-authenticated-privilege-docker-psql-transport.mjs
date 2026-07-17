import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const directory = await mkdtemp(path.join(os.tmpdir(), "openglass-docker-psql-transport-"));
const manifestPath = path.join(directory, "manifest.json");

try {
  execFileSync(process.execPath, [
    "scripts/prepare-operational-guardrails-authenticated-privilege-docker-psql-transport.mjs",
    "--dry-run",
    "--target-identity-fingerprint", "local-docker-normalized-replay",
    "--expected-target-identity-fingerprint", "local-docker-normalized-replay",
    "--connection-mode", "DIRECT_SSL_REQUIRED",
    "--manifest", manifestPath,
  ], { cwd: root, encoding: "utf8" });
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.manifestVersion, "docker-psql-reviewed-file-transport-v1");
  assert.match(manifest.repositoryCommit, /^[0-9a-f]{40}$/);
  assert.equal(manifest.sourceFile, "docs/ops/reconciliation/operational-guardrails-authenticated-privilege-supplemental-preflight.sql");
  assert.equal(manifest.hostSha256, "d96e76f9dd3655c03a64dc5d535087fc63f99370b13b246f6529caaf121cd074");
  assert.equal(manifest.containerSha256, manifest.hostSha256);
  assert.equal(manifest.hostByteCount, 8674);
  assert.equal(manifest.containerByteCount, manifest.hostByteCount);
  assert.equal(manifest.pinnedDockerDigest, "sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453");
  assert.equal(manifest.mountedReadOnly, true);
  assert.equal(manifest.targetIdentityFingerprint, manifest.expectedTargetIdentityFingerprint);
  assert.equal(manifest.connectionMode, "DIRECT_SSL_REQUIRED");
  assert.equal(manifest.dryRunValidation, "PASS");
  assert.match(manifest.transportCommandShape, /--mount type=bind/);
  assert.match(manifest.transportCommandShape, /readonly/);
  assert.match(manifest.transportCommandShape, /psql -X -v ON_ERROR_STOP=1/);
  assert.match(manifest.transportCommandShape, /sslmode=require/);
  assert.doesNotMatch(JSON.stringify(manifest), /PGPASSWORD|postgresql:\/\/|password=/i);
  assert.throws(() => execFileSync(process.execPath, [
    "scripts/prepare-operational-guardrails-authenticated-privilege-docker-psql-transport.mjs",
    "--dry-run",
    "--target-identity-fingerprint", "different-target-fingerprint",
    "--expected-target-identity-fingerprint", "local-docker-normalized-replay",
    "--connection-mode", "DIRECT_SSL_REQUIRED",
    "--manifest", path.join(directory, "must-not-exist.json"),
  ], { cwd: root, encoding: "utf8", stdio: "pipe" }), /observed target identity fingerprint must match/);
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log(JSON.stringify({ dockerPsqlDryRunManifestValidated: true, productionOperations: 0 }));
