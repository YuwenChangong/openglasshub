import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getHistoricalMinimalCanaryMutationPlanV1, getMinimalCanaryMutationPlan } from "./qa/r6-final-canary-execution-contract.mjs";
import { createDryRunSourceManifest, validateDryRunProductionSourceEligibility, validateDryRunSourceManifest, validateHistoricalDryRunManifest, validateNewDryRunPlan, validateOAuthReadinessAttestation } from "./qa/r6-dryrun-source-chain-contract.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "r6-dryrun-source-chain-"));
const commit = "a".repeat(40);
const runId = "qa-canary-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const now = (seconds) => () => new Date(Date.parse("2099-01-01T00:00:00.000Z") + seconds * 1000);
const oauth = { operation: "VALIDATE_CURRENT_CANONICAL_PRODUCTION_V3_OAUTH_PROFILE", classification: "R6_CURRENT_CANONICAL_PRODUCTION_V3_OAUTH_PREFLIGHT_READY", issuedAt: "2099-01-01T00:00:00.000Z" };
const exists = (value) => access(value).then(() => true, () => false);

function config(caseRoot, extra = {}) {
  const operatorRoot = path.join(caseRoot, "operator"); const evidenceRoot = path.join(caseRoot, "evidence"); const registryRoot = path.join(caseRoot, "registry");
  return { runId, executionCommit: commit, branch: "feature/r6-current-canonical-production-identity-v1", executionWorktree: caseRoot, wrapperPath: path.join(caseRoot, "wrapper.ps1"), wrapperSha256: "b".repeat(64), wranglerVersion: "4.106.0", wranglerEntrySha256: "c".repeat(64), operatorRoot, evidenceRoot, registryRoot, registryPath: path.join(registryRoot, "consumed-run-registry-v1.json"), launcherPath: path.join(caseRoot, "launcher.ps1"), launcherTerminalPath: path.join(operatorRoot, "launcher-terminal-result.json"), launcherBreadcrumbPath: path.join(operatorRoot, "launcher-stage-breadcrumb.json"), wrapperEntryMarkerPath: path.join(operatorRoot, "wrapper-entry-marker.json"), captureTerminalPath: path.join(evidenceRoot, "capture-terminal.json"), authCheckTerminalPath: path.join(evidenceRoot, "auth-check", "auth-terminal.json"), targetBindingPath: path.join(evidenceRoot, "dry-run", "target-binding.json"), receiptPath: path.join(registryRoot, "consumed-run-receipts-v1", runId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json"), dryRunTerminalPath: path.join(evidenceRoot, "dry-run", "terminal.json"), orchestrationTerminalPath: path.join(evidenceRoot, "orchestration-terminal.json"), confirmationSha256: "d".repeat(64), oauthAttestation: oauth, plan: getMinimalCanaryMutationPlan(), ...extra };
}

try {
  for (const second of [0, 59, 60]) assert.equal(validateOAuthReadinessAttestation(oauth, { now: now(second), atomic: true }).ageSeconds, second);
  for (const second of [61, 181]) assert.throws(() => validateOAuthReadinessAttestation(oauth, { now: now(second), atomic: true }), /R6_DRYRUN_OAUTH_ATTESTATION_FRESHNESS_INVALID/);
  for (const second of [179, 180]) assert.equal(validateOAuthReadinessAttestation(oauth, { now: now(second) }).ageSeconds, second);
  assert.throws(() => validateOAuthReadinessAttestation(oauth, { now: now(181) }), /R6_DRYRUN_OAUTH_ATTESTATION_FRESHNESS_INVALID/);
  assert.throws(() => validateOAuthReadinessAttestation({ ...oauth, issuedAt: "2099-01-01T00:00:00" }, { now: now(0) }), /R6_DRYRUN_OAUTH_ATTESTATION_INVALID/);
  assert.throws(() => validateOAuthReadinessAttestation({ ...oauth, classification: "NOT_READY" }, { now: now(0) }), /R6_DRYRUN_OAUTH_ATTESTATION_INVALID/);
  assert.throws(() => validateNewDryRunPlan(getHistoricalMinimalCanaryMutationPlanV1()), /R6_DRYRUN_PLAN_V2_REQUIRED/);
  assert.equal(validateHistoricalDryRunManifest({ schemaVersion: "r6-fresh-dryrun-launcher-binding-v2", runId, executionCommit: commit }).historical, true);
  const valid = createDryRunSourceManifest(config(root), { now: now(30), atomicOAuth: true });
  assert.equal(validateDryRunSourceManifest(valid).runId, runId); assert.equal(valid.singleUse.enabled, true); assert.equal(valid.attestationRemainingAtIssuerStartSeconds, 870);
  assert.equal(validateDryRunProductionSourceEligibility({ manifest: valid, executionCommit: commit, registryBinding: valid.registryBinding }).classification, "R6_DRYRUN_PRODUCTION_SOURCE_ELIGIBILITY_READY");
  assert.throws(() => validateDryRunProductionSourceEligibility({ manifest: { ...valid, schemaVersion: "r6-fresh-dryrun-launcher-binding-v2" }, registryBinding: valid.registryBinding }), /R6_DRYRUN_SOURCE_MANIFEST_INVALID/);
  assert.throws(() => createDryRunSourceManifest(config(root, { targetBindingPath: path.join(root, "escape", `${runId}.json`) }), { now: now(30), atomicOAuth: true }), /R6_DRYRUN_SOURCE_MANIFEST_PATH_INVALID/);
  assert.throws(() => createDryRunSourceManifest(config(root, { plan: { ...getMinimalCanaryMutationPlan(), retryContract: "one" } }), { now: now(30), atomicOAuth: true }), /R6_DRYRUN_PLAN_V2_REQUIRED/);

  const issuedRoot = path.join(root, "issued"); await mkdir(issuedRoot); const issued = config(issuedRoot, { __testNow: "2099-01-01T00:00:30.000Z", atomicOAuth: true });
  await writeFile(issued.wrapperPath, "param([string]$ExecutionWorktree,[switch]$PrepareCurrentCanonicalProductionV3AuthCheckAndDryRunOnly,[string]$RunId,[string]$EvidenceRoot)\n", "utf8");
  const configPath = path.join(issuedRoot, "config.json"); await writeFile(configPath, JSON.stringify(issued));
  execFileSync(process.execPath, ["scripts/qa/issue-r6-v3-operator-dryrun-package.mjs", "--config", configPath, "--launcher", issued.launcherPath, "--manifest", path.join(issued.operatorRoot, "dryrun-binding-manifest.json")], { cwd: process.cwd(), stdio: "pipe" });
  const issuedManifest = JSON.parse(await readFile(path.join(issued.operatorRoot, "dryrun-binding-manifest.json"), "utf8")); validateDryRunSourceManifest(issuedManifest);
  assert.equal(await exists(issued.evidenceRoot), false); assert.equal(await exists(issued.registryRoot), false);

  const failedRoot = path.join(root, "failed"); await mkdir(failedRoot); const failed = config(failedRoot, { __testNow: "2099-01-01T00:01:01.000Z", atomicOAuth: true }); await writeFile(failed.wrapperPath, "", "utf8"); const failedConfig = path.join(failedRoot, "config.json"); await writeFile(failedConfig, JSON.stringify(failed));
  assert.throws(() => execFileSync(process.execPath, ["scripts/qa/issue-r6-v3-operator-dryrun-package.mjs", "--config", failedConfig, "--launcher", failed.launcherPath, "--manifest", path.join(failed.operatorRoot, "dryrun-binding-manifest.json")], { cwd: process.cwd(), stdio: "pipe" }), /R6_DRYRUN_OAUTH_ATTESTATION_FRESHNESS_INVALID/);
  assert.equal(await exists(failed.operatorRoot), false); assert.equal(await exists(failed.launcherPath), false);
  console.log("R6_DRYRUN_SOURCE_CHAIN_AND_OAUTH_ATOMIC_CONTRACT_FIXTURES_OK");
} finally { await rm(root, { recursive: true, force: true }); }
