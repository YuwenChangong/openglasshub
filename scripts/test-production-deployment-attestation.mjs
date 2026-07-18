import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ATTESTATION_ENVIRONMENT, ATTESTATION_PROJECT, ATTESTATION_PROVIDER, ATTESTATION_SCHEMA_VERSION,
  CANONICAL_PRODUCTION_URL, PRODUCTION_TARGET_IDENTITY_HASH, validateDeploymentAttestation,
} from "./qa/production-deployment-attestation.mjs";

const commit = "b9ec4a06fb4aa67d7963c5d53ccc91e5c3965ed6";
const now = Date.parse("2026-07-18T10:00:00.000Z");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const valueFor = (patch = {}) => ({
  schemaVersion: ATTESTATION_SCHEMA_VERSION,
  provider: ATTESTATION_PROVIDER,
  projectName: ATTESTATION_PROJECT,
  environment: ATTESTATION_ENVIRONMENT,
  canonicalBaseUrl: CANONICAL_PRODUCTION_URL,
  immutableDeploymentUrl: "https://6f11bcf1.openglasshub.pages.dev/",
  deploymentId: "6f11bcf1-65a7-4e9c-aa25-30ec1fd7fb8a",
  sourceCommit: commit,
  observedAt: "2026-07-18T09:55:00.000Z",
  expiresAt: "2026-07-18T10:05:00.000Z",
  queryOrProviderEvidenceSha256: "a".repeat(64),
  targetIdentityHash: PRODUCTION_TARGET_IDENTITY_HASH,
  classification: "PRODUCTION_DEPLOYMENT_IDENTITY_EXACT",
  ...patch,
});

const root = await mkdtemp(path.join(os.tmpdir(), "qa-attestation-root-"));
const write = async (name, value) => {
  const file = path.join(root, name);
  const raw = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(JSON.stringify(value), "utf8");
  await writeFile(file, raw);
  return { file, hash: sha256(raw) };
};
const validate = async (file, hash, expectedCommit = commit) => validateDeploymentAttestation({ attestationPath: file, expectedSha256: hash, expectedCommit, root, now });

try {
  const exact = await write("exact.json", valueFor());
  const result = await validate(exact.file, exact.hash);
  assert.equal(result.sourceCommit, commit);
  await assert.rejects(validate(path.join(root, "missing.json"), "a".repeat(64)), /QA_CANARY_DEPLOYMENT_ATTESTATION_MISSING/);
  await assert.rejects(validate(exact.file, "b".repeat(64)), /QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID/);
  for (const [name, patch, expected] of [
    ["malformed", "{", /QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID/],
    ["schema", { schemaVersion: "v0" }, /QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID/],
    ["preview", { environment: "preview" }, /QA_CANARY_DEPLOYMENT_TARGET_MISMATCH/],
    ["canonical", { canonicalBaseUrl: "https://preview.openglasshub.pages.dev" }, /QA_CANARY_DEPLOYMENT_TARGET_MISMATCH/],
    ["immutable", { immutableDeploymentUrl: "https://x.example.com/" }, /QA_CANARY_DEPLOYMENT_TARGET_MISMATCH/],
    ["short", { sourceCommit: "b9ec4a0" }, /QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID/],
    ["different", { sourceCommit: "a".repeat(40) }, /QA_CANARY_DEPLOYED_COMMIT_MISMATCH/],
    ["stale", { observedAt: "2026-07-18T09:40:00.000Z", expiresAt: "2026-07-18T09:55:00.000Z" }, /QA_CANARY_DEPLOYMENT_ATTESTATION_STALE/],
    ["future", { observedAt: "2026-07-18T10:01:00.000Z", expiresAt: "2026-07-18T10:05:00.000Z" }, /QA_CANARY_DEPLOYMENT_ATTESTATION_STALE/],
    ["expired", { observedAt: "2026-07-18T09:50:00.000Z", expiresAt: "2026-07-18T09:59:00.000Z" }, /QA_CANARY_DEPLOYMENT_ATTESTATION_STALE/],
    ["identity", { targetIdentityHash: "c".repeat(64) }, /QA_CANARY_DEPLOYMENT_TARGET_MISMATCH/],
  ]) {
    const sample = await write(`${name}.json`, patch === "{" ? patch : valueFor(patch));
    await assert.rejects(validate(sample.file, sample.hash), expected, name);
  }
  const outside = await mkdtemp(path.join(os.tmpdir(), "qa-attestation-outside-"));
  const outsideFile = path.join(outside, "outside.json");
  await writeFile(outsideFile, JSON.stringify(valueFor()));
  await assert.rejects(validate(outsideFile, sha256(await (await import("node:fs/promises")).readFile(outsideFile))), /QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID/);
  const linked = path.join(root, "linked.json");
  await symlink(outsideFile, linked, "file");
  await assert.rejects(validate(linked, sha256(await (await import("node:fs/promises")).readFile(outsideFile))), /QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID/);
  await rm(outside, { recursive: true, force: true });
  console.log("PRODUCTION_DEPLOYMENT_ATTESTATION_OK exact, malformed, freshness, target, hash, and path guards passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
