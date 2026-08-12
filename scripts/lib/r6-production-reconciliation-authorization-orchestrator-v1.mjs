import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { loadCanonicalLauncherTemplateAuthority } from "./r6-canonical-launcher-template-authority.mjs";
import { loadCanonicalSecureWrapperSourceAuthority } from "./r6-canonical-secure-wrapper-source-authority.mjs";
import { issueAttestedCandidateV3 } from "./r6-production-reconciliation-candidate-issuer-v3.mjs";
import { loadCandidateAuthority } from "./r6-production-reconciliation-candidate-authority.mjs";
import { confirmationAuthorityRootForRepository, issueFreshConfirmationPhraseV1, loadConfirmationPhraseIssuanceV1 } from "./r6-production-reconciliation-confirmation-phrase-v1.mjs";
import { issueExecutionBindingV2, loadExecutionBindingV2 } from "./r6-production-reconciliation-execution-binding-v2.mjs";
import { issueProductionReconciliationV4Package, loadProductionReconciliationV4Package } from "./r6-production-reconciliation-package-v4.mjs";
import { CANONICAL_FINGERPRINT_BASELINE_SHA256 } from "./r6-production-reconciliation-transport-contract.mjs";

const COMMIT = /^[a-f0-9]{40}$/;
const hash = value => createHash("sha256").update(value).digest("hex");
const fail = code => { throw Object.assign(new Error(code), { code }); };

function currentCommit(repositoryRoot) {
  let value;
  try { value = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
  catch { fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_SOURCE_COMMIT_UNAVAILABLE"); }
  if (!COMMIT.test(value)) fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_SOURCE_COMMIT_UNAVAILABLE");
  return value;
}

async function requireUnusedAbsolutePath(value, code) {
  if (!path.isAbsolute(String(value ?? ""))) fail(code);
  try { await access(value); fail(code); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  return path.resolve(value);
}

export async function issueCurrentProductionAuthorizationV1({ repositoryRoot, packageRoot, candidateRoot, executionBindingOutputPath, testOnly = false, testAuthorityRoot } = {}) {
  if (!path.isAbsolute(String(repositoryRoot ?? ""))) fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_INPUT_INVALID");
  const [resolvedPackageRoot, resolvedCandidateRoot, resolvedBindingPath] = await Promise.all([
    requireUnusedAbsolutePath(packageRoot, "R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_PACKAGE_ROOT_INVALID"),
    requireUnusedAbsolutePath(candidateRoot, "R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_CANDIDATE_ROOT_INVALID"),
    requireUnusedAbsolutePath(executionBindingOutputPath, "R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_EXECUTION_BINDING_OUTPUT_INVALID"),
  ]);
  if (resolvedBindingPath !== path.join(resolvedCandidateRoot, "execution-binding-v2.json")) fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_EXECUTION_BINDING_OUTPUT_INVALID");

  const sourceCommit = currentCommit(repositoryRoot);
  const [launcher, wrapper, transportBytes] = await Promise.all([
    loadCanonicalLauncherTemplateAuthority({ repositoryRoot }),
    loadCanonicalSecureWrapperSourceAuthority({ repositoryRoot }),
    readFile(path.join(repositoryRoot, "scripts", "qa", "r6-production-reconciliation-transport.mjs")),
  ]);
  const packageIssued = await issueProductionReconciliationV4Package({
    packageRoot: resolvedPackageRoot, repositoryRoot, implementationCommit: sourceCommit,
    launcherSha256: launcher.canonicalLauncherTemplateSha256,
    secureWrapperSha256: wrapper.canonicalSecureWrapperSourceSha256,
    baselineSha256: CANONICAL_FINGERPRINT_BASELINE_SHA256,
  });
  const packageLoaded = await loadProductionReconciliationV4Package({ packageRoot: resolvedPackageRoot, repositoryRoot });
  if (packageLoaded.executionPackage.sourceCommit !== sourceCommit) fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_PACKAGE_RELOAD_FAILED");

  const confirmationIssued = await issueFreshConfirmationPhraseV1({ repositoryRoot, sourceCommit, testOnly, testAuthorityRoot });
  const confirmation = await loadConfirmationPhraseIssuanceV1({ repositoryRoot, issuancePath: confirmationIssued.receipt.path, sourceCommit, testOnly, testAuthorityRoot });
  if (hash(confirmationIssued.confirmationPhrase) !== confirmation.value.confirmationPhraseSha256) fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_CONFIRMATION_COMMITMENT_FAILED");

  const candidateIssued = await issueAttestedCandidateV3({
    candidateRoot: resolvedCandidateRoot, packageRoot: resolvedPackageRoot, repositoryRoot,
    transportImplementationCommit: sourceCommit, transportLauncherSha256: launcher.canonicalLauncherTemplateSha256,
    transportSha256: hash(transportBytes), confirmationIssuancePath: confirmation.path, testOnly, testAuthorityRoot,
  });
  const candidateAuthority = await loadCandidateAuthority({ candidateRoot: resolvedCandidateRoot });
  const confirmationRoot = testOnly && path.isAbsolute(String(testAuthorityRoot ?? ""))
    ? path.resolve(testAuthorityRoot)
    : confirmationAuthorityRootForRepository(repositoryRoot);
  const confirmationBindingPath = path.join(confirmationRoot, "candidate-bindings", `${confirmation.value.confirmationPhraseSha256}.json`);
  const confirmationBindingBytes = await readFile(confirmationBindingPath);
  const confirmationBinding = JSON.parse(confirmationBindingBytes.toString("utf8"));
  if (confirmationBinding.sourceCommit !== sourceCommit || confirmationBinding.candidateId !== candidateAuthority.candidate.authorizationId || confirmationBinding.confirmationPhraseSha256 !== confirmation.value.confirmationPhraseSha256) fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_CONFIRMATION_BINDING_FAILED");

  const executionBinding = await issueExecutionBindingV2({ outputPath: resolvedBindingPath, repositoryRoot, packageRoot: resolvedPackageRoot, candidateRoot: resolvedCandidateRoot });
  const bindingReloaded = await loadExecutionBindingV2({ executionBindingPath: resolvedBindingPath, repositoryRoot, packageRoot: resolvedPackageRoot, candidateRoot: resolvedCandidateRoot });
  if (bindingReloaded.sha256 !== executionBinding.sha256 || bindingReloaded.value.launcherSha256 !== launcher.canonicalLauncherTemplateSha256) fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_EXECUTION_BINDING_RELOAD_FAILED");

  return Object.freeze({
    classification: "R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_V1_AWAITING_HUMAN_CONFIRMATION",
    sourceCommit, packageIssued, packageLoaded, confirmationIssued, confirmation, candidateIssued, candidateAuthority,
    confirmationBindingPath, confirmationBindingSha256: hash(confirmationBindingBytes), executionBinding: bindingReloaded,
    canonicalLauncherTemplateSha256: launcher.canonicalLauncherTemplateSha256,
    canonicalSecureWrapperSourceSha256: wrapper.canonicalSecureWrapperSourceSha256,
    transportSha256: hash(transportBytes),
  });
}
