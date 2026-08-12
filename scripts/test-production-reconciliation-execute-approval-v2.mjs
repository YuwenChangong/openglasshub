import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { issueAttestedCandidateV3 } from "./lib/r6-production-reconciliation-candidate-issuer-v3.mjs";
import { loadCanonicalLauncherTemplateAuthority } from "./lib/r6-canonical-launcher-template-authority.mjs";
import { EXECUTE_APPROVAL_V2_VERSION, buildExecuteApprovalV2, issueExecuteApprovalV2, loadExecuteApprovalV2, validateExecuteApprovalV2 } from "./lib/r6-production-reconciliation-execute-approval-v2.mjs";
import { issueProductionReconciliationV4Package } from "./lib/r6-production-reconciliation-package-v4.mjs";
import { finalizeHumanConfirmation, prepareFinalExecutionFromExecuteApprovalV2 } from "./qa/r6-production-reconciliation-transport.mjs";
import { createLocalR6ProductionReconciliationAuthorityFixture } from "./test-support/r6-production-reconciliation-local-authority-fixture.mjs";

const root = process.cwd();
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const hash = value => createHash("sha256").update(value).digest("hex");
const baseline = "adec5b5933cc70869be55efbabb613b555c890f0e755e01b13b28696e67c9b4a";
const capability = { executablePath: "C:\\offline\\psql.exe", executableSha256: hash("psql"), version: "offline", help: "offline" };

async function fixture() {
  const temp = await mkdtemp(path.join(os.tmpdir(), "r6-execute-v2-"));
  return { temp, ...await createLocalR6ProductionReconciliationAuthorityFixture({ tempRoot: temp, repositoryRoot: root, sourceCommit: commit }) };
}

const fixtures = [];
try {
  const valid = await fixture(); fixtures.push(valid);
  const input = { repositoryRoot: root, ...valid };
  const approval = await buildExecuteApprovalV2(input);
  assert.equal(approval.schemaVersion, EXECUTE_APPROVAL_V2_VERSION);
  const canonicalAuthority = await loadCanonicalLauncherTemplateAuthority({ repositoryRoot: root });
  assert.equal(approval.canonicalLauncherTemplateSha256, canonicalAuthority.canonicalLauncherTemplateSha256);
  const outputPath = path.join(valid.temp, "execute-v2-under-test.json");
  await issueExecuteApprovalV2({ ...input, outputPath });
  await loadExecuteApprovalV2({ ...input, approvalPath: outputPath });
  const prepared = await prepareFinalExecutionFromExecuteApprovalV2({ ...input, approvalPath: outputPath, receiptRoot: path.join(valid.temp, "receipts"), evidenceRoot: path.join(valid.temp, "evidence"), sqlClientCapability: capability });
  assert.equal(prepared.invariant, "EVIDENCE_ROOT_CREATED_AND_BOUND_BEFORE_SQL_CLIENT");
  assert.equal(prepared.finalExecutionAuthority.canonicalLauncherTemplateSha256, approval.canonicalLauncherTemplateSha256);
  assert.equal(approval.launcherBindingSchemaVersion, "r6-production-reconciliation-launcher-binding-v2");
  assert.notEqual(approval.canonicalLauncherTemplateSha256, approval.launcherBindingSha256);
  console.log("R6_PRODUCTION_RECONCILIATION_HISTORICAL_BINDING_V2_EVIDENCE_BOUNDARY_PASS");

  const canonicalMismatch = JSON.parse(await readFile(outputPath));
  await writeFile(outputPath, `${JSON.stringify({ ...canonicalMismatch, canonicalLauncherTemplateSha256: hash("wrong-canonical-template") })}\n`);
  await assert.rejects(() => loadExecuteApprovalV2({ ...input, approvalPath: outputPath }), /EXECUTE_APPROVAL_V2_BINDING_FAILED/);
  await writeFile(outputPath, `${JSON.stringify(canonicalMismatch)}\n`);

  for (const [artifact, field] of [["production-reconciliation-candidate.json", "candidateSha256"], ["production-reconciliation-candidate-terminal.json", "candidateTerminalSha256"], ["production-reconciliation-candidate-inventory.json", "candidateInventorySha256"]]) {
    const negative = await fixture(); fixtures.push(negative);
    await writeFile(path.join(negative.candidateRoot, artifact), "{}\n");
    await assert.rejects(() => buildExecuteApprovalV2({ repositoryRoot: root, ...negative }), /CANDIDATE_AUTHORITY|AUTHORIZATION_V4_INVALID/);
    assert.ok(field);
  }
  for (const replacement of ["r6-production-reconciliation-final-human-confirmation-v4", "qa-production-reconciliation-final-human-confirmation-v3"]) {
    const negative = await fixture(); fixtures.push(negative);
    const final = JSON.parse(await readFile(negative.finalConfirmationPath)); final.schemaVersion = replacement;
    await writeFile(negative.finalConfirmationPath, `${JSON.stringify(final)}\n`);
    await assert.rejects(() => buildExecuteApprovalV2({ repositoryRoot: root, ...negative }), /FINAL_CONFIRMATION_V5_INVALID/);
  }
  const crossLineage = await fixture(); fixtures.push(crossLineage);
  await assert.rejects(() => buildExecuteApprovalV2({ repositoryRoot: root, ...valid, finalConfirmationPath: crossLineage.finalConfirmationPath }), /FINAL_CONFIRMATION_V5_BINDING_FAILED/);

  const claimFailure = await fixture(); fixtures.push(claimFailure);
  const claimFinal = JSON.parse(await readFile(claimFailure.finalConfirmationPath));
  const originalClaim = JSON.parse(await readFile(claimFinal.globalConsumptionClaimPathOrKey));
  for (const [field, value] of [["sourceCommit", "0".repeat(40)], ["packageId", "00000000-0000-4000-8000-000000000000"], ["candidateId", "00000000-0000-4000-8000-000000000000"], ["confirmationPhraseSha256", hash("wrong-phrase")]]) {
    await writeFile(claimFinal.globalConsumptionClaimPathOrKey, `${JSON.stringify({ ...originalClaim, [field]: value })}\n`);
    await assert.rejects(() => buildExecuteApprovalV2({ repositoryRoot: root, ...claimFailure }), /GLOBAL_CONFIRMATION_CLAIM_INVALID/);
  }
  await writeFile(claimFinal.globalConsumptionClaimPathOrKey, "{}\n");
  await assert.rejects(() => buildExecuteApprovalV2({ repositoryRoot: root, ...claimFailure }), /GLOBAL_CONFIRMATION_CLAIM_INVALID/);

  const bindingFailure = await fixture(); fixtures.push(bindingFailure);
  const binding = JSON.parse(await readFile(bindingFailure.executionBindingPath)); binding.launcherSha256 = hash("wrong");
  await writeFile(bindingFailure.executionBindingPath, `${JSON.stringify(binding)}\n`);
  await assert.rejects(() => buildExecuteApprovalV2({ repositoryRoot: root, ...bindingFailure }), /EXECUTION_BINDING_INVALID|EXECUTION_BINDING_V2_BINDING_FAILED|EXECUTE_APPROVAL_V2_BINDING_FAILED/);

  const legacyBinding = await fixture(); fixtures.push(legacyBinding);
  const legacy = JSON.parse(await readFile(legacyBinding.executionBindingPath)); legacy.schemaVersion = "r6-production-reconciliation-launcher-binding-v1";
  await writeFile(legacyBinding.executionBindingPath, `${JSON.stringify(legacy)}\n`);
  await assert.rejects(() => buildExecuteApprovalV2({ repositoryRoot: root, ...legacyBinding }), /LAUNCHER_BINDING_V2_INVALID/);

  for (const field of ["canonicalMigrationSha256", "canonicalMigrationBytes", "postflightSha256", "baselineSha256"]) {
    const value = field === "canonicalMigrationBytes" ? 1 : hash(`wrong-${field}`);
    assert.throws(() => validateExecuteApprovalV2({ ...approval, [field]: value }), /EXECUTE_APPROVAL_V2_INVALID/);
  }

  const historical = { ...approval, schemaVersion: "r6-production-reconciliation-execute-approval-v1", finalConfirmationSchemaVersion: "r6-production-reconciliation-final-human-confirmation-v4" };
  const historicalPath = path.join(valid.temp, "historical-v1.json"); await writeFile(historicalPath, `${JSON.stringify(historical)}\n`);
  await assert.rejects(() => loadExecuteApprovalV2({ ...input, approvalPath: historicalPath }), /EXECUTE_APPROVAL_V2_INVALID/);
  await assert.rejects(() => prepareFinalExecutionFromExecuteApprovalV2({ ...input, approvalPath: historicalPath, receiptRoot: path.join(valid.temp, "historical-receipts"), evidenceRoot: path.join(valid.temp, "historical-evidence"), sqlClientCapability: capability }), /EXECUTE_APPROVAL_V2_INVALID/);

  const persistedFinal = JSON.parse(await readFile(valid.finalConfirmationPath));
  await writeFile(valid.finalConfirmationPath, `${JSON.stringify({ ...persistedFinal, issuedAtUtc: "2020-01-01T00:00:00.000Z" })}\n`);
  await assert.rejects(() => loadExecuteApprovalV2({ ...input, approvalPath: outputPath }), /EXECUTE_APPROVAL_V2_BINDING_FAILED/);
  console.log("R6_PRODUCTION_RECONCILIATION_EXECUTE_APPROVAL_V2_PASS");
} finally { await Promise.all(fixtures.map(value => rm(value.temp, { recursive: true, force: true }))); }
