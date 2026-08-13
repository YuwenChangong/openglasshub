import { access, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { loadCandidateAuthority } from "./r6-production-reconciliation-candidate-authority.mjs";
import { loadConfirmationPhraseCandidateBindingV1, loadConfirmationPhraseIssuanceV1 } from "./r6-production-reconciliation-confirmation-phrase-v1.mjs";
import { loadExecutionBindingV2 } from "./r6-production-reconciliation-execution-binding-v2.mjs";
import { issueExecuteApprovalV2, loadExecuteApprovalV2 } from "./r6-production-reconciliation-execute-approval-v2.mjs";
import { loadProductionReconciliationV4Package } from "./r6-production-reconciliation-package-v4.mjs";
import { finalizeHumanConfirmation, validateFinalExecutionBinding } from "../qa/r6-production-reconciliation-transport.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const COMMIT = /^[a-f0-9]{40}$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const finalName = "production-reconciliation-final-human-confirmation-v5.json";
const executeName = "production-reconciliation-execute-approval-v2.json";

const requireMissing = async (artifactPath, code) => {
  try { await access(artifactPath); fail(code); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
};

async function countHashRecords(root, field, expectedHash) {
  const entries = await (async function collect(current) {
    const children = await readdir(current, { withFileTypes: true }).catch(() => []);
    return (await Promise.all(children.map(async entry => entry.isDirectory()
      ? collect(path.join(current, entry.name))
      : entry.isFile() && entry.name.endsWith(".json") ? [path.join(current, entry.name)] : []))).flat();
  })(root);
  let count = 0;
  for (const artifactPath of entries) {
    try { if (JSON.parse(await readFile(artifactPath, "utf8"))[field] === expectedHash) count += 1; } catch { /* canonical loaders validate required artifacts */ }
  }
  return count;
}

async function reloadPreHumanLineage({ repositoryRoot, packageRoot, candidateRoot, executionBindingPath, sourceCommit, testOnly, testAuthorityRoot }) {
  const [packageLoaded, authority, executionBinding] = await Promise.all([
    loadProductionReconciliationV4Package({ packageRoot, repositoryRoot }),
    loadCandidateAuthority({ candidateRoot }),
    loadExecutionBindingV2({ executionBindingPath, repositoryRoot, packageRoot, candidateRoot }),
  ]);
  const candidate = authority.candidate;
  const confirmationRoot = testOnly ? path.resolve(testAuthorityRoot) : path.resolve(repositoryRoot, "..", "r6-production-reconciliation-confirmation-authority-v1");
  const issuancePath = path.join(confirmationRoot, "issuances", `${candidate.requiredConfirmationSha256}.json`);
  const issuance = await loadConfirmationPhraseIssuanceV1({ repositoryRoot, issuancePath, sourceCommit, testOnly, testAuthorityRoot });
  const bindingPath = path.join(confirmationRoot, "candidate-bindings", `${candidate.requiredConfirmationSha256}.json`);
  const confirmationBinding = await loadConfirmationPhraseCandidateBindingV1({ repositoryRoot, bindingPath, issuance, candidate, testOnly, testAuthorityRoot });
  if (packageLoaded.executionPackage.sourceCommit !== sourceCommit
    || candidate.transportImplementationCommit !== sourceCommit
    || issuance.value.sourceCommit !== sourceCommit
    || confirmationBinding.value.sourceCommit !== sourceCommit
    || candidate.expectedProjectRef !== packageLoaded.routingIdentity.routeAuthority.projectRef
    || executionBinding.value.expectedProjectRef !== candidate.expectedProjectRef) fail("R6_PRODUCTION_RECONCILIATION_POST_CONFIRMATION_PRECONSUMPTION_BINDING_INVALID");
  const route = packageLoaded.routingIdentity.routeAuthority;
  if (route.connectionMode !== "SHARED_POOLER_SESSION" || route.pgHost !== "aws-1-ap-northeast-1.pooler.supabase.com" || route.pgPort !== "5432" || route.pgDatabase !== "postgres" || route.pgUser !== "postgres.xcbnxzjlsvtgzixurcof") fail("R6_PRODUCTION_RECONCILIATION_POST_CONFIRMATION_ROUTE_AUTHORITY_INVALID");
  if (await countHashRecords(path.join(confirmationRoot, "issuances"), "confirmationPhraseSha256", candidate.requiredConfirmationSha256) !== 1
    || await countHashRecords(path.join(confirmationRoot, "candidate-bindings"), "confirmationPhraseSha256", candidate.requiredConfirmationSha256) !== 1) fail("R6_PRODUCTION_RECONCILIATION_POST_CONFIRMATION_HASH_UNIQUENESS_FAILED");
  return Object.freeze({ packageLoaded, authority, executionBinding, issuance, confirmationBinding, confirmationRoot, route });
}

export async function advancePostConfirmationToExecuteV2({ repositoryRoot, packageRoot, candidateRoot, confirmationPhrase, sqlClientCapability, testOnly = false, testAuthorityRoot, testFailureStage } = {}) {
  if (!path.isAbsolute(String(repositoryRoot ?? "")) || !path.isAbsolute(String(packageRoot ?? "")) || !path.isAbsolute(String(candidateRoot ?? "")) || typeof confirmationPhrase !== "string" || (!testOnly && testAuthorityRoot !== undefined)) fail("R6_PRODUCTION_RECONCILIATION_POST_CONFIRMATION_INPUT_INVALID");
  const sourceCommit = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (!COMMIT.test(sourceCommit)) fail("R6_PRODUCTION_RECONCILIATION_POST_CONFIRMATION_SOURCE_COMMIT_INVALID");
  const executionBindingPath = path.join(path.resolve(candidateRoot), "execution-binding-v2.json");
  const finalConfirmationPath = path.join(path.resolve(candidateRoot), finalName);
  const executeApprovalPath = path.join(path.resolve(candidateRoot), executeName);
  await Promise.all([
    requireMissing(finalConfirmationPath, "R6_PRODUCTION_RECONCILIATION_POST_CONFIRMATION_ALREADY_ADVANCED"),
    requireMissing(executeApprovalPath, "R6_PRODUCTION_RECONCILIATION_POST_CONFIRMATION_ALREADY_ADVANCED"),
  ]);
  const preflight = await reloadPreHumanLineage({ repositoryRoot, packageRoot, candidateRoot, executionBindingPath, sourceCommit, testOnly, testAuthorityRoot });
  if (hash(confirmationPhrase) !== preflight.authority.candidate.requiredConfirmationSha256) fail("R6_PRODUCTION_RECONCILIATION_CONFIRMATION_INVALID");
  const afterClaimForTest = testFailureStage === "global-claim"
    ? async () => { fail("R6_POST_CONFIRMATION_TEST_GLOBAL_CLAIM_FAILURE"); }
    : testFailureStage === "final-persistence"
      ? async () => { await writeFile(finalConfirmationPath, "{}\n"); }
      : null;
  const finalized = await finalizeHumanConfirmation({ authorizationPath: preflight.authority.candidateArtifact.path, packageRoot, finalConfirmationPath, confirmationPhrase, implementationCommit: sourceCommit, launcherSha256: preflight.authority.candidate.transportLauncherSha256, transportSha256: preflight.authority.candidate.transportSha256, sqlClientCapability, afterClaimForTest });
  if (testFailureStage === "execute-persistence") await writeFile(executeApprovalPath, "{}\n");
  const finalBinding = await validateFinalExecutionBinding({ authorizationPath: preflight.authority.candidateArtifact.path, packageRoot, finalConfirmationPath, implementationCommit: sourceCommit, launcherSha256: preflight.authority.candidate.transportLauncherSha256, transportSha256: preflight.authority.candidate.transportSha256 });
  const executeIssued = await issueExecuteApprovalV2({ outputPath: executeApprovalPath, repositoryRoot, packageRoot, candidateRoot, finalConfirmationPath, executionBindingPath });
  const executeReloaded = await loadExecuteApprovalV2({ approvalPath: executeApprovalPath, repositoryRoot, packageRoot, candidateRoot, finalConfirmationPath, executionBindingPath });
  if (executeReloaded.artifact.sha256 !== executeIssued.sha256 || executeReloaded.approval.sourceCommit !== sourceCommit || executeReloaded.approval.expectedProjectRef !== preflight.route.projectRef || executeReloaded.approval.finalConfirmationSha256 !== finalized.finalConfirmationSha256 || executeReloaded.approval.globalConsumptionClaimSha256 !== finalBinding.finalConfirmation.globalConsumptionClaimSha256) fail("R6_PRODUCTION_RECONCILIATION_POST_CONFIRMATION_EXECUTE_V2_RELOAD_FAILED");
  const finalArtifact = JSON.parse(await readFile(finalConfirmationPath, "utf8"));
  return Object.freeze({ classification: "R6_PRODUCTION_RECONCILIATION_FINAL_RC_EXECUTE_V2_OFFLINE_AUTHORITY_READY", sourceCommit, route: preflight.route, executionBinding: preflight.executionBinding, confirmationPhraseSha256: preflight.authority.candidate.requiredConfirmationSha256, confirmationConsumed: true, finalConfirmationPath, finalConfirmationSha256: finalized.finalConfirmationSha256, globalClaimPath: finalArtifact.globalConsumptionClaimPathOrKey, globalClaimSha256: finalArtifact.globalConsumptionClaimSha256, executeApprovalPath, executeApprovalSha256: executeReloaded.artifact.sha256, executeApproval: executeReloaded.approval });
}
