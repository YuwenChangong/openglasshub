import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { main, parse, RUNNER_REPOSITORY_ROOT, validateIdentityGuards } from "./qa/run-production-minimal-canary.mjs";
import { ATTESTATION_ENVIRONMENT, ATTESTATION_PROJECT, ATTESTATION_PROVIDER, ATTESTATION_SCHEMA_VERSION, CANONICAL_PRODUCTION_URL, PRODUCTION_TARGET_IDENTITY_HASH } from "./qa/production-deployment-attestation.mjs";

const runnerCommit = execFileSync("git", ["-C", RUNNER_REPOSITORY_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const now = Date.now();
const root = await mkdtemp(path.join(os.tmpdir(), "qa-runner-contract-"));
const journalRoot = path.join(root, "journals");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const runId = (suffix) => `qa-canary-${suffix}`;
const exactRunId = runId("11111111-1111-4111-8111-111111111111");
const attestationValue = (patch = {}) => ({
  schemaVersion: ATTESTATION_SCHEMA_VERSION,
  provider: ATTESTATION_PROVIDER,
  projectName: ATTESTATION_PROJECT,
  environment: ATTESTATION_ENVIRONMENT,
  canonicalBaseUrl: CANONICAL_PRODUCTION_URL,
  immutableDeploymentUrl: "https://6f11bcf1.openglasshub.pages.dev/",
  deploymentId: "6f11bcf1-65a7-4e9c-aa25-30ec1fd7fb8a",
  sourceCommit: runnerCommit,
  observedAt: new Date(now - 60_000).toISOString(),
  expiresAt: new Date(now + 10 * 60_000).toISOString(),
  queryOrProviderEvidenceSha256: "d".repeat(64),
  targetIdentityHash: PRODUCTION_TARGET_IDENTITY_HASH,
  classification: "PRODUCTION_DEPLOYMENT_IDENTITY_EXACT",
  ...patch,
});
const writeAttestation = async (value = attestationValue()) => {
  const file = path.join(root, `attestation-${Math.random().toString(16).slice(2)}.json`);
  const raw = Buffer.from(JSON.stringify(value), "utf8");
  await writeFile(file, raw);
  return { file, sha256: hash(raw) };
};
const baseEnv = (attestation) => ({
  QA_SUPABASE_URL: "https://abcdef.supabase.co",
  QA_EXPECTED_SUPABASE_REF: "abcdef",
  QA_PRODUCTION_SUPABASE_REF: "abcdef",
  QA_BASE_URL: "https://openglasshub.pages.dev",
  QA_CANARY_USER_ID: "11111111-1111-4111-8111-111111111111",
  QA_EXPECTED_RUNNER_COMMIT: runnerCommit,
  QA_EXPECTED_DEPLOYED_COMMIT: runnerCommit,
  QA_DEPLOYMENT_ATTESTATION_PATH: attestation.file,
  QA_DEPLOYMENT_ATTESTATION_SHA256: attestation.sha256,
  QA_CANARY_SUPABASE_ANON_KEY: "public-test-key",
  QA_CANARY_ACCESS_TOKEN: "test-token",
  QA_CANARY_CIRCLE_SLUG: "qa-circle",
  QA_ALLOW_PRODUCTION_WRITES: "1",
  QA_CANARY_JOURNAL_ROOT: journalRoot,
});
const dryArgs = (id = exactRunId) => ["--dry-run", "--run-id", id, "--confirm-run", id];

try {
  const attestation = await writeAttestation();
  const env = baseEnv(attestation);
  const options = parse(dryArgs());
  const originalCwd = process.cwd();
  const temporaryCwd = await mkdtemp(path.join(os.tmpdir(), "qa-runner-cwd-"));
  let adapterCalls = 0;
  try {
    process.chdir(temporaryCwd);
    const first = await validateIdentityGuards({ options, env, now, attestationRoot: root });
    assert.equal(first.runnerCommit, runnerCommit);
    process.chdir(RUNNER_REPOSITORY_ROOT);
    const second = await validateIdentityGuards({ options, env, now, attestationRoot: root });
    assert.equal(second.runnerCommit, runnerCommit);
    await main(dryArgs(), env, { attestationRoot: root, createAdapter: () => { adapterCalls += 1; throw new Error("ADAPTER_CONSTRUCTED"); } });
    assert.equal(adapterCalls, 0, "dry-run must not construct the live adapter");
  } finally {
    process.chdir(originalCwd);
    await rm(temporaryCwd, { recursive: true, force: true });
  }
  await assert.rejects(validateIdentityGuards({ options, env: { ...env, QA_EXPECTED_RUNNER_COMMIT: "a".repeat(40) }, now, attestationRoot: root }), /QA_CANARY_RUNNER_COMMIT_MISMATCH/);
  await assert.rejects(validateIdentityGuards({ options, env: { ...env, QA_EXPECTED_RUNNER_COMMIT: "" }, now, attestationRoot: root }), /QA_CANARY_ENV_REQUIRED:QA_EXPECTED_RUNNER_COMMIT/);
  await assert.rejects(validateIdentityGuards({ options, env: { ...env, QA_DEPLOYMENT_ATTESTATION_PATH: path.join(root, "absent.json") }, now, attestationRoot: root }), /QA_CANARY_DEPLOYMENT_ATTESTATION_MISSING/);
  await assert.rejects(validateIdentityGuards({ options, env: { ...env, QA_DEPLOYMENT_ATTESTATION_SHA256: "a".repeat(64) }, now, attestationRoot: root }), /QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID/);
  await assert.rejects(validateIdentityGuards({ options, env: { ...env, QA_EXPECTED_DEPLOYED_COMMIT: "a".repeat(40) }, now, attestationRoot: root }), /QA_CANARY_DEPLOYED_COMMIT_MISMATCH/);
  await assert.rejects(main(dryArgs("qa-canary-d5d9eed0-a599-4cf6-be98-39e2060d2340"), env, { attestationRoot: root }), /QA_CANARY_RUN_ID_PREVIOUSLY_FAILED/);
  let liveAdapterCalls = 0;
  await assert.rejects(main(["--execute", "--run-id", runId("22222222-2222-4222-8222-222222222222"), "--confirm-run", runId("22222222-2222-4222-8222-222222222222")], { ...env, QA_CANARY_APPROVAL: "APPROVE_R6Y_BUILD_CRASH_SAFE_MINIMAL_PRODUCTION_CANARY_AND_COMPLETE_R6", QA_DEPLOYMENT_ATTESTATION_SHA256: "a".repeat(64) }, { attestationRoot: root, createAdapter: () => { liveAdapterCalls += 1; return {}; } }), /QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID/);
  assert.equal(liveAdapterCalls, 0, "identity rejection must precede live adapter construction");
  console.log("PRODUCTION_MINIMAL_CANARY_RUNNER_CONTRACT_OK CWD-independent runner commit and sealed deployment attestation guards passed with no network");
} finally {
  await rm(root, { recursive: true, force: true });
}
