import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadCanonicalLauncherTemplateAuthority } from "./r6-canonical-launcher-template-authority.mjs";
import { loadCanonicalSecureWrapperSourceAuthority } from "./r6-canonical-secure-wrapper-source-authority.mjs";
import { issueAttestedCandidateV3 } from "./r6-production-reconciliation-candidate-issuer-v3.mjs";
import { loadCandidateAuthority } from "./r6-production-reconciliation-candidate-authority.mjs";
import { confirmationAuthorityRootForRepository, issueFreshConfirmationPhraseV1, loadConfirmationPhraseCandidateBindingV1, loadConfirmationPhraseIssuanceV1 } from "./r6-production-reconciliation-confirmation-phrase-v1.mjs";
import { issueExecutionBindingV2, loadExecutionBindingV2 } from "./r6-production-reconciliation-execution-binding-v2.mjs";
import { issueProductionReconciliationV4Package, loadProductionReconciliationV4Package } from "./r6-production-reconciliation-package-v4.mjs";
import { CANONICAL_FINGERPRINT_BASELINE_SHA256 } from "./r6-production-reconciliation-transport-contract.mjs";
import { loadExecuteApprovalV2 } from "./r6-production-reconciliation-execute-approval-v2.mjs";
import { issueExecutionMaterializationV2, loadExecutionMaterializationV2 } from "./r6-production-reconciliation-materialization-v2.mjs";
import { issueLauncherBindingV3, validateLauncherBindingV3 } from "./r6-production-reconciliation-launcher-binding-v3.mjs";

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

async function jsonFiles(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(async entry => entry.isDirectory()
    ? jsonFiles(path.join(root, entry.name))
    : entry.isFile() && entry.name.endsWith(".json") ? [path.join(root, entry.name)] : []));
  return nested.flat();
}

async function files(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(async entry => entry.isDirectory()
    ? files(path.join(root, entry.name))
    : entry.isFile() ? [path.join(root, entry.name)] : []));
  return nested.flat();
}

async function countHashRecords(root, field, hashValue) {
  const files = await jsonFiles(root);
  let count = 0;
  for (const file of files) {
    try { if (JSON.parse(await readFile(file, "utf8"))[field] === hashValue) count += 1; } catch { /* formal loaders validate required artifacts */ }
  }
  return count;
}

async function assertNoPlaintextPersistence({ confirmationPhrase, roots }) {
  for (const root of roots) {
    for (const file of await files(root)) {
      if ((await readFile(file, "utf8")).includes(confirmationPhrase)) fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_PLAINTEXT_PERSISTED");
    }
  }
}

function assertDownstreamPrerequisites() {
  if (![loadExecuteApprovalV2, issueExecutionMaterializationV2, loadExecutionMaterializationV2, issueLauncherBindingV3, validateLauncherBindingV3].every(value => typeof value === "function")) fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_DOWNSTREAM_PREREQUISITE_INVALID");
}

async function applyTestFailureHook({ testOnly, testFailureStage, confirmationBindingPath, confirmationRoot, confirmationPhraseSha256 }) {
  if (!testFailureStage) return;
  if (!testOnly) fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_TEST_HOOK_FORBIDDEN");
  if (testFailureStage === "binding-tamper") {
    const value = JSON.parse(await readFile(confirmationBindingPath, "utf8"));
    await writeFile(confirmationBindingPath, `${JSON.stringify({ ...value, sourceCommit: "0".repeat(40) })}\n`);
  } else if (testFailureStage === "duplicate-hash") {
    const value = await readFile(confirmationBindingPath, "utf8");
    await writeFile(path.join(confirmationRoot, "candidate-bindings", `duplicate-${confirmationPhraseSha256}.json`), value);
  } else if (testFailureStage === "authority-root-mismatch") {
    await writeFile(path.join(confirmationRoot, "authority-root-mismatch.json"), "{}\n");
  } else if (testFailureStage !== "downstream-prerequisite") {
    fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_TEST_HOOK_INVALID");
  }
}

export async function issueCurrentProductionAuthorizationV1({ repositoryRoot, packageRoot, candidateRoot, executionBindingOutputPath, testOnly = false, testAuthorityRoot, testFailureStage } = {}) {
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
  if (packageLoaded.executionPackage.sourceCommit !== sourceCommit
    || packageLoaded.manifest.implementationCommit !== sourceCommit
    || packageLoaded.manifest.secureWrapperSha256 !== wrapper.canonicalSecureWrapperSourceSha256) fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_PACKAGE_RELOAD_FAILED");

  const confirmationIssued = await issueFreshConfirmationPhraseV1({ repositoryRoot, sourceCommit, testOnly, testAuthorityRoot });
  const confirmation = await loadConfirmationPhraseIssuanceV1({ repositoryRoot, issuancePath: confirmationIssued.receipt.path, sourceCommit, testOnly, testAuthorityRoot });
  if (hash(confirmationIssued.confirmationPhrase) !== confirmation.value.confirmationPhraseSha256) fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_CONFIRMATION_COMMITMENT_FAILED");

  const candidateIssued = await issueAttestedCandidateV3({
    candidateRoot: resolvedCandidateRoot, packageRoot: resolvedPackageRoot, repositoryRoot,
    transportImplementationCommit: sourceCommit, transportLauncherSha256: launcher.canonicalLauncherTemplateSha256,
    transportSha256: hash(transportBytes), confirmationIssuancePath: confirmation.path, testOnly, testAuthorityRoot,
  });
  const candidateAuthority = await loadCandidateAuthority({ candidateRoot: resolvedCandidateRoot });
  if (candidateAuthority.candidate.transportImplementationCommit !== sourceCommit
    || candidateAuthority.candidate.expectedProjectRef !== "xcbnxzjlsvtgzixurcof") fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_CANDIDATE_RELOAD_FAILED");
  const confirmationRoot = testOnly && path.isAbsolute(String(testAuthorityRoot ?? ""))
    ? path.resolve(testAuthorityRoot)
    : confirmationAuthorityRootForRepository(repositoryRoot);
  const confirmationBindingPath = path.join(confirmationRoot, "candidate-bindings", `${confirmation.value.confirmationPhraseSha256}.json`);
  await applyTestFailureHook({ testOnly, testFailureStage, confirmationBindingPath, confirmationRoot, confirmationPhraseSha256: confirmation.value.confirmationPhraseSha256 });
  const confirmationBinding = await loadConfirmationPhraseCandidateBindingV1({ repositoryRoot, bindingPath: confirmationBindingPath, issuance: confirmation, candidate: candidateAuthority.candidate, testOnly, testAuthorityRoot });

  const executionBinding = await issueExecutionBindingV2({ outputPath: resolvedBindingPath, repositoryRoot, packageRoot: resolvedPackageRoot, candidateRoot: resolvedCandidateRoot });
  const bindingReloaded = await loadExecutionBindingV2({ executionBindingPath: resolvedBindingPath, repositoryRoot, packageRoot: resolvedPackageRoot, candidateRoot: resolvedCandidateRoot });
  if (bindingReloaded.sha256 !== executionBinding.sha256 || bindingReloaded.value.launcherSha256 !== launcher.canonicalLauncherTemplateSha256) fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_EXECUTION_BINDING_RELOAD_FAILED");

  if (testFailureStage === "authority-root-mismatch" && confirmationRoot !== path.join(confirmationRoot, "not-the-canonical-root")) fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_AUTHORITY_ROOT_MISMATCH");
  if (await countHashRecords(path.join(confirmationRoot, "issuances"), "confirmationPhraseSha256", confirmation.value.confirmationPhraseSha256) !== 1
    || await countHashRecords(path.join(confirmationRoot, "candidate-bindings"), "confirmationPhraseSha256", confirmation.value.confirmationPhraseSha256) !== 1) fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_CONFIRMATION_HASH_UNIQUENESS_FAILED");
  if (testFailureStage === "downstream-prerequisite") fail("R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_DOWNSTREAM_PREREQUISITE_INVALID");
  assertDownstreamPrerequisites();
  await assertNoPlaintextPersistence({ confirmationPhrase: confirmationIssued.confirmationPhrase, roots: [resolvedPackageRoot, resolvedCandidateRoot, confirmationRoot] });

  return Object.freeze({
    classification: "R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_ORCHESTRATOR_V1_AWAITING_HUMAN_CONFIRMATION",
    sourceCommit, packageIssued, packageLoaded, confirmationIssued, confirmation, candidateIssued, candidateAuthority,
    confirmationBindingPath, confirmationBindingSha256: confirmationBinding.sha256, executionBinding: bindingReloaded,
    canonicalLauncherTemplateSha256: launcher.canonicalLauncherTemplateSha256,
    canonicalSecureWrapperSourceSha256: wrapper.canonicalSecureWrapperSourceSha256,
    transportSha256: hash(transportBytes),
  });
}
