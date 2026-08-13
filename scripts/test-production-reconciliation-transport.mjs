import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { issueAttestedCandidateV3 } from "./lib/r6-production-reconciliation-candidate-issuer-v3.mjs";
import { issueExecuteApprovalV2, loadExecuteApprovalV2 } from "./lib/r6-production-reconciliation-execute-approval-v2.mjs";
import { issueExecutionBindingV2 } from "./lib/r6-production-reconciliation-execution-binding-v2.mjs";
import { loadCanonicalLauncherTemplateAuthority } from "./lib/r6-canonical-launcher-template-authority.mjs";
import { issueProductionReconciliationV4Package } from "./lib/r6-production-reconciliation-package-v4.mjs";
import { executeWithFinalExecutionGate, executeWithHistoricalFinalExecutionGate, finalizeHumanConfirmation } from "./qa/r6-production-reconciliation-transport.mjs";

const repositoryRoot = process.cwd();
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
const hash = value => createHash("sha256").update(value).digest("hex");
const baseline = "adec5b5933cc70869be55efbabb613b555c890f0e755e01b13b28696e67c9b4a";
const capability = { executablePath: "C:\\offline\\psql.exe", executableSha256: hash("psql"), version: "offline", help: "offline" };
const routing = { PGHOST: "aws-1-ap-northeast-1.pooler.supabase.com", PGPORT: "5432", PGDATABASE: "postgres", PGUSER: "postgres.xcbnxzjlsvtgzixurcof" };

async function fixture() {
  const temp = await mkdtemp(path.join(os.tmpdir(), "r6-production-transport-v2-"));
  const launcherSha256 = hash("offline-launcher"); const secureWrapperSha256 = hash("offline-secure-wrapper"); const transportSha256 = hash("offline-transport"); const phrase = "offline-transport-confirmation";
  const packageRoot = path.join(temp, "package");
  await issueProductionReconciliationV4Package({ packageRoot, repositoryRoot, implementationCommit: commit, launcherSha256, secureWrapperSha256, baselineSha256: baseline });
  const candidateRoot = path.join(temp, "candidate");
  const issued = await issueAttestedCandidateV3({ candidateRoot, packageRoot, repositoryRoot, transportImplementationCommit: commit, transportLauncherSha256: launcherSha256, transportSha256, requiredConfirmationPhrase: phrase, testOnly: true, testAuthorityRoot: path.join(temp, "authority") });
  const finalConfirmationPath = path.join(temp, "final-v5.json");
  await finalizeHumanConfirmation({ authorizationPath: issued.candidateArtifact.path, packageRoot, finalConfirmationPath, confirmationPhrase: phrase, implementationCommit: commit, launcherSha256, transportSha256, sqlClientCapability: capability });
  const executionBindingPath = path.join(temp, "execution-binding-v2.json");
  await issueExecutionBindingV2({ outputPath: executionBindingPath, repositoryRoot, packageRoot, candidateRoot });
  const approvalPath = path.join(temp, "execute-v2.json");
  await issueExecuteApprovalV2({ outputPath: approvalPath, repositoryRoot, packageRoot, candidateRoot, finalConfirmationPath, executionBindingPath });
  return { temp, approvalPath, packageRoot, candidateRoot, finalConfirmationPath, executionBindingPath, transportSha256 };
}

const client = counters => ({
  async targetProbe() { counters.target += 1; return { outcome: "TARGET_SUCCESS", observedProbeOutput: JSON.stringify({ database: "postgres", currentUser: "postgres", sessionUser: "postgres", serverVersionNum: "170006", clusterName: "main", inRecovery: false }) }; },
  async prepare() { return { outcome: "READY" }; },
  async submitMigration() { counters.mutations += 1; return { outcome: "COMMITTED" }; },
  async postflight(_bytes, { outputPath }) { await writeFile(outputPath, "offline-postflight\n"); return { outcome: "POSTFLIGHT_SUCCESS" }; },
});

const fixtures = [];
try {
  const happy = await fixture(); fixtures.push(happy);
  const canonicalAuthority = await loadCanonicalLauncherTemplateAuthority({ repositoryRoot });
  const loadedHappy = await loadExecuteApprovalV2({ repositoryRoot, ...happy, approvalPath: happy.approvalPath });
  assert.equal(loadedHappy.approval.canonicalLauncherTemplateSha256, canonicalAuthority.canonicalLauncherTemplateSha256);
  const calls = { count: 0 }; const counters = { target: 0, mutations: 0 };
  const result = await executeWithFinalExecutionGate({ repositoryRoot, ...happy, receiptRoot: path.join(happy.temp, "receipts"), evidenceRoot: path.join(happy.temp, "evidence"), environment: routing, sqlClientCapability: capability, clientFactory: () => { calls.count += 1; return client(counters); } });
  assert.equal(result.classification, "R6_PRODUCTION_RECONCILIATION_EXECUTION_AND_POSTFLIGHT_COMPLETE");
  assert.equal(calls.count, 1); assert.equal(counters.target, 1); assert.equal(counters.mutations, 1);

  const invalidRouting = await fixture(); fixtures.push(invalidRouting);
  const noFactory = { count: 0 };
  const invalidResult = await executeWithFinalExecutionGate({ repositoryRoot, ...invalidRouting, receiptRoot: path.join(invalidRouting.temp, "receipts"), evidenceRoot: path.join(invalidRouting.temp, "evidence"), environment: { ...routing, PGUSER: "postgres.aaaaaaaaaaaaaaaaaaaa" }, sqlClientCapability: capability, clientFactory: () => { noFactory.count += 1; return client({ target: 0, mutations: 0 }); } });
  assert.equal(invalidResult.classification, "R6_PRODUCTION_RECONCILIATION_RUNTIME_ROUTE_AUTHORITY_MISMATCH");
  assert.equal(noFactory.count, 0);

  const missingApproval = await fixture(); fixtures.push(missingApproval);
  const preSql = { count: 0 };
  await assert.rejects(() => executeWithFinalExecutionGate({ repositoryRoot, ...missingApproval, approvalPath: path.join(missingApproval.temp, "missing-v2.json"), receiptRoot: path.join(missingApproval.temp, "receipts"), evidenceRoot: path.join(missingApproval.temp, "evidence"), environment: routing, sqlClientCapability: capability, clientFactory: () => { preSql.count += 1; return client({ target: 0, mutations: 0 }); } }), /EXECUTE_APPROVAL_V2_MISSING/);
  assert.equal(preSql.count, 0);

  const canonicalMismatch = await fixture(); fixtures.push(canonicalMismatch);
  const mismatchApproval = JSON.parse(await readFile(canonicalMismatch.approvalPath));
  await writeFile(canonicalMismatch.approvalPath, `${JSON.stringify({ ...mismatchApproval, canonicalLauncherTemplateSha256: hash("wrong-canonical-template") })}\n`);
  const canonicalPreSql = { count: 0 };
  await assert.rejects(() => executeWithFinalExecutionGate({ repositoryRoot, ...canonicalMismatch, receiptRoot: path.join(canonicalMismatch.temp, "receipts"), evidenceRoot: path.join(canonicalMismatch.temp, "evidence"), environment: routing, sqlClientCapability: capability, clientFactory: () => { canonicalPreSql.count += 1; return client({ target: 0, mutations: 0 }); } }), /EXECUTE_APPROVAL_V2_BINDING_FAILED/);
  assert.equal(canonicalPreSql.count, 0);
  await assert.rejects(() => executeWithHistoricalFinalExecutionGate({}), /HISTORICAL_EXECUTION_PATH_NOT_EXECUTABLE/);
  console.log("R6_PRODUCTION_RECONCILIATION_TRANSPORT_V2_FAKE_HARNESS_READY");
} finally { await Promise.all(fixtures.map(value => rm(value.temp, { recursive: true, force: true }))); }
