import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { issueAttestedCandidateV3 } from "../lib/r6-production-reconciliation-candidate-issuer-v3.mjs";
import { issueExecuteApprovalV2 } from "../lib/r6-production-reconciliation-execute-approval-v2.mjs";
import { issueProductionReconciliationV4Package } from "../lib/r6-production-reconciliation-package-v4.mjs";
import { finalizeHumanConfirmation } from "../qa/r6-production-reconciliation-transport.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const baseline = "adec5b5933cc70869be55efbabb613b555c890f0e755e01b13b28696e67c9b4a";
const capability = { executablePath: "C:\\offline\\psql.exe", executableSha256: hash("psql"), version: "offline", help: "offline" };

export async function createLocalR6ProductionReconciliationAuthorityFixture({ tempRoot, repositoryRoot, sourceCommit }) {
  await mkdir(tempRoot, { recursive: true });
  const launcherSha256 = hash("fixture-launcher"), secureWrapperSha256 = hash("fixture-wrapper"), transportSha256 = hash("fixture-transport"), phrase = "fixture-confirmation";
  const packageRoot = path.join(tempRoot, "package"), candidateRoot = path.join(tempRoot, "candidate"), finalConfirmationPath = path.join(tempRoot, "final-v5.json"), executionBindingPath = path.join(tempRoot, "execution-binding-v2.json"), approvalPath = path.join(tempRoot, "execute-v2.json");
  await issueProductionReconciliationV4Package({ packageRoot, repositoryRoot, implementationCommit: sourceCommit, launcherSha256, secureWrapperSha256, baselineSha256: baseline });
  const issued = await issueAttestedCandidateV3({ candidateRoot, packageRoot, repositoryRoot, transportImplementationCommit: sourceCommit, transportLauncherSha256: launcherSha256, transportSha256, requiredConfirmationPhrase: phrase, testOnly: true, testAuthorityRoot: path.join(tempRoot, "authority") });
  await finalizeHumanConfirmation({ authorizationPath: issued.candidateArtifact.path, packageRoot, finalConfirmationPath, confirmationPhrase: phrase, implementationCommit: sourceCommit, launcherSha256, transportSha256, sqlClientCapability: capability });
  await writeFile(executionBindingPath, `${JSON.stringify({ schemaVersion: "r6-production-reconciliation-launcher-binding-v2", packageSchemaVersion: issued.candidate.packageSchemaVersion, targetIdentitySchemaVersion: issued.candidate.targetIdentitySchemaVersion, targetIdentityCanonicalSha256: issued.candidate.targetIdentityCanonicalSha256, runtimeRoutingSchemaVersion: issued.candidate.runtimeRoutingSchemaVersion, runtimeRoutingArtifactSha256: issued.candidate.runtimeRoutingArtifactSha256, expectedProjectRef: issued.candidate.expectedProjectRef, launcherSha256, secureWrapperSha256 })}\n`);
  await issueExecuteApprovalV2({ outputPath: approvalPath, repositoryRoot, packageRoot, candidateRoot, finalConfirmationPath, executionBindingPath });
  return Object.freeze({ packageRoot, candidateRoot, finalConfirmationPath, executionBindingPath, approvalPath, transportSha256, sqlClientCapability: capability, expectedProjectRef: issued.candidate.expectedProjectRef, sourceCommit });
}
