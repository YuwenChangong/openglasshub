import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { main, parse, RUNNER_REPOSITORY_ROOT, validateIdentityGuards } from "./qa/run-production-minimal-canary.mjs";
import { ATTESTATION_ENVIRONMENT, ATTESTATION_PROJECT, ATTESTATION_PROVIDER, ATTESTATION_SCHEMA_VERSION, CANONICAL_PRODUCTION_URL, PRODUCTION_TARGET_IDENTITY_HASH } from "./qa/production-deployment-attestation.mjs";
import { backfillHistoricalConsumedRuns, reserveConsumedRun } from "./qa/production-minimal-canary-consumed-run-registry.mjs";
import { createCanonicalCanaryTargetBinding } from "./qa/canonical-canary-target-binding.mjs";
import { getMinimalCanaryMutationPlan } from "./qa/r6-final-canary-execution-contract.mjs";

const runnerCommit = execFileSync("git", ["-C", RUNNER_REPOSITORY_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const now = Date.now();
const root = await mkdtemp(path.join(os.tmpdir(), "qa-runner-contract-"));
const journalRoot = path.join(root, "journals");
const registryRoot = path.join(root, "consumed-runs");
const targetBindingPath = path.join(root, "canonical-canary-target-binding.json");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const targetPlan = getMinimalCanaryMutationPlan();
await writeFile(targetBindingPath, JSON.stringify(createCanonicalCanaryTargetBinding({ resolvedAtUtc: "2099-01-01T00:00:00.000Z", canonicalCircleId: "22222222-2222-4222-8222-222222222222", canonicalCircleSlug: "qa-circle", baseMutationPlanSchema: targetPlan.schemaVersion, baseMutationPlanHash: targetPlan.planSha256, executionCommit: runnerCommit, toolingCommit: runnerCommit })));
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
  expiresAt: new Date(now + 13 * 60_000).toISOString(),
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
  QA_EXPECTED_TOOLING_COMMIT: runnerCommit,
  QA_EXPECTED_DEPLOYED_COMMIT: runnerCommit,
  QA_DEPLOYMENT_ATTESTATION_PATH: attestation.file,
  QA_DEPLOYMENT_ATTESTATION_SHA256: attestation.sha256,
  QA_CANARY_SUPABASE_ANON_KEY: "public-test-key",
  QA_CANARY_ACCESS_TOKEN: "test-token",
  QA_CANARY_TARGET_BINDING_PATH: targetBindingPath,
  QA_ALLOW_PRODUCTION_WRITES: "1",
  QA_CANARY_JOURNAL_ROOT: journalRoot,
  QA_CANARY_CONSUMED_RUN_REGISTRY_ROOT: registryRoot,
});
const dryArgs = (id = exactRunId) => ["--dry-run", "--run-id", id, "--confirm-run", id];
async function withReservation(env, id, mode) {
  const childCommandDigest = hash(JSON.stringify(mode === "live" ? ["node", "scripts/qa/run-production-minimal-canary.mjs", "--execute", "--run-id", id, "--confirm-run", id] : ["node", "scripts/qa/run-production-minimal-canary.mjs", "--dry-run", "--run-id", id, "--confirm-run", id]));
  const reservation = await reserveConsumedRun({ root: registryRoot, runId: id, mode, confirmationTokenSha256: hash(`token:${id}`), runnerCommit, wrapperVersion: "r6-consumed-run-wrapper-v1", wrapperSha256: "a".repeat(64), childCommandDigest });
  return { ...env, QA_CANARY_CONSUMED_RUN_RECEIPT_PATH: reservation.receiptPath, QA_CANARY_CONSUMED_RUN_RECEIPT_SHA256: reservation.receiptSha256, QA_CANARY_CONSUMED_RUN_NONCE: reservation.invocationNonce, QA_CANARY_WRAPPER_VERSION: "r6-consumed-run-wrapper-v1", QA_CANARY_WRAPPER_SHA256: "a".repeat(64), QA_CANARY_CHILD_COMMAND_SHA256: childCommandDigest };
}

try {
  const historicalIds = ["qa-canary-d5d9eed0-a599-4cf6-be98-39e2060d2340", "qa-canary-cf466ba5-5eb1-48ba-b18c-f20b60193a07", "qa-canary-e61e9405-8fab-4570-8a6b-a23a0841ac37", "qa-canary-76c5e82b-e601-4ccc-b571-b949f35c28d2", "qa-canary-60622b81-6c5f-40fd-a73b-bfb0cf559f9d"];
  await backfillHistoricalConsumedRuns({ root: registryRoot, records: historicalIds.map((runId) => ({ runId, legacyBlock: true })) });
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
    assert.equal(first.expectedToolingCommit, runnerCommit);
    process.chdir(RUNNER_REPOSITORY_ROOT);
    const second = await validateIdentityGuards({ options, env, now, attestationRoot: root });
    assert.equal(second.runnerCommit, runnerCommit);
    await main(dryArgs(), await withReservation(env, exactRunId, "dry-run"), { attestationRoot: root, createAdapter: () => { adapterCalls += 1; throw new Error("ADAPTER_CONSTRUCTED"); } });
    assert.equal(adapterCalls, 0, "dry-run must not construct the live adapter");
  } finally {
    process.chdir(originalCwd);
    await rm(temporaryCwd, { recursive: true, force: true });
  }
  await assert.rejects(validateIdentityGuards({ options, env: { ...env, QA_EXPECTED_RUNNER_COMMIT: "a".repeat(40), QA_EXPECTED_TOOLING_COMMIT: "a".repeat(40) }, now, attestationRoot: root }), /QA_CANARY_RUNNER_COMMIT_MISMATCH/);
  await assert.rejects(validateIdentityGuards({ options, env: { ...env, QA_EXPECTED_TOOLING_COMMIT: "a".repeat(40) }, now, attestationRoot: root }), /QA_CANARY_V3_ATTESTATION_TOOLING_COMMIT_MISMATCH/);
  await assert.rejects(validateIdentityGuards({ options, env: { ...env, QA_EXPECTED_RUNNER_COMMIT: "" }, now, attestationRoot: root }), /QA_CANARY_ENV_REQUIRED:QA_EXPECTED_RUNNER_COMMIT/);
  await assert.rejects(validateIdentityGuards({ options, env: { ...env, QA_DEPLOYMENT_ATTESTATION_PATH: path.join(root, "absent.json") }, now, attestationRoot: root }), /QA_CANARY_DEPLOYMENT_ATTESTATION_MISSING/);
  await assert.rejects(validateIdentityGuards({ options, env: { ...env, QA_DEPLOYMENT_ATTESTATION_SHA256: "a".repeat(64) }, now, attestationRoot: root }), /QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID/);
  await assert.rejects(validateIdentityGuards({ options, env: { ...env, QA_EXPECTED_DEPLOYED_COMMIT: "a".repeat(40) }, now, attestationRoot: root }), /QA_CANARY_DEPLOYED_COMMIT_MISMATCH/);
  for (const historicalId of historicalIds) {
    let adapters = 0;
    await assert.rejects(main(dryArgs(historicalId), env, { attestationRoot: root, createReadAdapter: () => { adapters += 1; throw new Error("NETWORK_CONSTRUCTED"); } }), /QA_CANARY_RUN_ID_ALREADY_CONSUMED/);
    assert.equal(adapters, 0, "consumed historical IDs must reject before adapters or network");
  }
  let liveAdapterCalls = 0;
  const invalidAttestationRunId = runId("22222222-2222-4222-8222-222222222222");
  await assert.rejects(main(["--execute", "--run-id", invalidAttestationRunId, "--confirm-run", invalidAttestationRunId], await withReservation({ ...env, QA_CANARY_APPROVAL: "APPROVE_R6Y_BUILD_CRASH_SAFE_MINIMAL_PRODUCTION_CANARY_AND_COMPLETE_R6", QA_DEPLOYMENT_ATTESTATION_SHA256: "a".repeat(64) }, invalidAttestationRunId, "live"), { attestationRoot: root, createAdapter: () => { liveAdapterCalls += 1; return {}; } }), /QA_CANARY_DEPLOYMENT_ATTESTATION_INVALID/);
  assert.equal(liveAdapterCalls, 0, "identity rejection must precede live adapter construction");
  const liveRunId = runId("33333333-3333-4333-8333-333333333333");
  const events = [];
  await main(["--execute", "--run-id", liveRunId, "--confirm-run", liveRunId], await withReservation({
    ...env,
    QA_CANARY_APPROVAL: "APPROVE_R6_HARDENED_WRITE_AHEAD_FRESH_ATTESTATION_AUTH_DRY_RUN_AND_CANARY_EXECUTION",
  }, liveRunId, "live"), {
    attestationRoot: root,
    createReadAdapter: () => ({
      async authenticate() { events.push("authenticate"); return { id: "11111111-1111-4111-8111-111111111111" }; },
      async resolveCircle() { events.push("resolveCircle"); return { id: "22222222-2222-4222-8222-222222222222", slug: "qa-circle" }; },
    }),
    createAdapter: () => ({
      async createPost({ marker }) { events.push("createPost"); return { id: "33333333-3333-4333-8333-333333333333", ownerId: "11111111-1111-4111-8111-111111111111", circleId: "22222222-2222-4222-8222-222222222222", circleSlug: "qa-circle", marker }; },
      async createComment({ marker, postId }) { events.push("createComment"); return { id: "44444444-4444-4444-8444-444444444444", ownerId: "11111111-1111-4111-8111-111111111111", circleId: "22222222-2222-4222-8222-222222222222", circleSlug: "qa-circle", postId, marker }; },
      async deleteComment() { events.push("deleteComment"); }, async deletePost() { events.push("deletePost"); }, async verifyCommentAbsent() { return true; }, async verifyPostAbsent() { return true; }, async verifyResidue() { return { ok: true }; },
    }),
  });
  assert.deepEqual(events, ["authenticate", "createPost", "createComment", "deleteComment", "deletePost"], "the live runner must consume the prevalidated canonical target without resolving a circle again");
  console.log("PRODUCTION_MINIMAL_CANARY_RUNNER_CONTRACT_OK CWD-independent runner commit and sealed deployment attestation guards passed with no network");
} finally {
  await rm(root, { recursive: true, force: true });
}
