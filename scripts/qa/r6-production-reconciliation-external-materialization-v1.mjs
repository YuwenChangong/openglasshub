import { createHash } from "node:crypto";
import { copyFile, mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { loadCanonicalSecureWrapperSourceAuthority } from "../lib/r6-canonical-secure-wrapper-source-authority.mjs";
import { prepareFinalExecutionFromExecuteApprovalV2 } from "./r6-production-reconciliation-transport.mjs";
import { issueExecutionMaterializationV2, loadExecutionMaterializationV2 } from "../lib/r6-production-reconciliation-materialization-v2.mjs";
import { issueLauncherBindingV3, loadLauncherBindingV3 } from "../lib/r6-production-reconciliation-launcher-binding-v3.mjs";
import { renderProductionReconciliationLauncherV3 } from "./render-r6-production-reconciliation-launcher.mjs";
import { loadCanonicalLauncherTemplateAuthority } from "../lib/r6-canonical-launcher-template-authority.mjs";
import { validateExecutionMaterializationV2 } from "../lib/r6-production-reconciliation-materialization-v2.mjs";
import { validateLauncherBindingV3AgainstCanonicalTemplate } from "../lib/r6-production-reconciliation-launcher-binding-v3.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = code => { throw Object.assign(new Error(code), { code }); };
const HASH = /^[a-f0-9]{64}$/;
const readyKeys = ["schemaVersion","sourceCommit","state","ready","canonicalLauncherTemplateSha256","canonicalSecureWrapperSourceSha256","secureWrapperRelativePath","secureWrapperSha256","materializationRelativePath","materializationSha256","launcherBindingRelativePath","launcherBindingSha256","renderedLauncherRelativePath","renderedLauncherObservedSha256","executeApprovalSha256","finalExecutionAuthoritySha256","expectedProjectRef","issuedAtUtc"];
function contained(root, relativePath) { if (path.isAbsolute(relativePath)) fail("R6_PRODUCTION_RECONCILIATION_EXTERNAL_READY_PATH_INVALID"); const resolved = path.resolve(root, relativePath); const prefix = `${path.resolve(root)}${path.sep}`; if (!resolved.startsWith(prefix)) fail("R6_PRODUCTION_RECONCILIATION_EXTERNAL_READY_PATH_INVALID"); return resolved; }
function loadRenderedLauncherConfig(bytes) {
  const match = bytes.toString("utf8").match(/FromBase64String\(['\"]([^'\"]+)['\"]\)/);
  if (!match) fail("R6_PRODUCTION_RECONCILIATION_EXTERNAL_READY_LAUNCHER_INVALID");
  try { return JSON.parse(Buffer.from(match[1], "base64").toString("utf8")); }
  catch { fail("R6_PRODUCTION_RECONCILIATION_EXTERNAL_READY_LAUNCHER_INVALID"); }
}

export async function materializeExternalSecureWrapperV1({ repositoryRoot, externalRoot }) {
  const root = path.resolve(externalRoot);
  try { await mkdir(root, { recursive: false }); } catch (error) { if (error?.code === "EEXIST") fail("R6_PRODUCTION_RECONCILIATION_EXTERNAL_MATERIALIZATION_ROOT_REUSED"); throw error; }
  const source = await loadCanonicalSecureWrapperSourceAuthority({ repositoryRoot });
  const wrapperPath = path.join(root, "start-r6-production-reconciliation-secure-session.ps1");
  await copyFile(source.canonicalSecureWrapperSourcePath, wrapperPath, 0);
  const observedBytes = await readFile(wrapperPath);
  const secureWrapperSha256 = hash(observedBytes);
  if (!observedBytes.equals(await readFile(source.canonicalSecureWrapperSourcePath))) fail("R6_PRODUCTION_RECONCILIATION_EXTERNAL_MATERIALIZATION_WRAPPER_COPY_INVALID");
  const inventoryPath = path.join(root, "external-materialization-inventory.json");
  const inventory = { schemaVersion: "r6-production-reconciliation-external-root-creation-receipt-v1", externalRoot: root, state: "PREPARING", canonicalSecureWrapperSourceSha256: source.canonicalSecureWrapperSourceSha256, secureWrapperRelativePath: path.basename(wrapperPath), secureWrapperSha256, ready: false };
  let handle;
  try { handle = await open(inventoryPath, "wx", 0o600); await handle.writeFile(`${JSON.stringify(inventory)}\n`); } finally { await handle?.close(); }
  return Object.freeze({ externalRoot: root, wrapperPath, inventoryPath, canonicalSecureWrapperSourceSha256: source.canonicalSecureWrapperSourceSha256, secureWrapperSha256, ready: false });
}

export async function prepareExternalExecutionMaterializationV1(input) {
  const base = await materializeExternalSecureWrapperV1(input);
  const { repositoryRoot, externalRoot } = input;
  const materializationPath = path.join(externalRoot, "execution-materialization-v2.json");
  const bindingPath = path.join(externalRoot, "launcher-binding-v3.json");
  const launcherPath = path.join(externalRoot, "start-r6-production-reconciliation.ps1");
  const readyPath = path.join(externalRoot, "external-materialization-ready.json");
  if (typeof input.materializationEvidenceRoot !== "string" || input.materializationEvidenceRoot.length === 0) fail("R6_PRODUCTION_RECONCILIATION_EXTERNAL_MATERIALIZATION_AUTHORITY_EVIDENCE_REQUIRED");
  const prepared = await prepareFinalExecutionFromExecuteApprovalV2({ ...input, repositoryRoot, receiptRoot: input.receiptRoot, evidenceRoot: input.materializationEvidenceRoot });
  const issuedMaterialization = await issueExecutionMaterializationV2({ ...input, outputPath: materializationPath, finalExecutionAuthority: prepared.finalExecutionAuthority, secureWrapperSha256: base.secureWrapperSha256 });
  await loadExecutionMaterializationV2({ ...input, materializationPath, finalExecutionAuthority: prepared.finalExecutionAuthority });
  const issuedBinding = await issueLauncherBindingV3({ outputPath: bindingPath, materializationPath, externalSecureWrapperPath: base.wrapperPath, launcherPath, finalExecutionAuthority: prepared.finalExecutionAuthority, repositoryRoot });
  await loadLauncherBindingV3({ bindingPath, materializationPath, externalSecureWrapperPath: base.wrapperPath, finalExecutionAuthority: prepared.finalExecutionAuthority, repositoryRoot });
  await renderProductionReconciliationLauncherV3({ config: { repositoryRoot, materializationPath, launcherBindingPath: bindingPath, transportPath: input.transportPath, transportSha256: input.transportSha256, nodePath: input.nodePath, approvalPath: input.approvalPath, packageRoot: input.packageRoot, candidateRoot: input.candidateRoot, finalConfirmationPath: input.finalConfirmationPath, executionBindingPath: input.executionBindingPath, receiptRoot: input.receiptRoot, evidenceRoot: input.evidenceRoot }, destination: launcherPath });
  const files = await Promise.all([base.wrapperPath, materializationPath, bindingPath, launcherPath].map(file => readFile(file)));
  const ready = { schemaVersion: "r6-production-reconciliation-external-materialization-inventory-v1", sourceCommit: prepared.finalExecutionAuthority.sourceCommit, state: "READY", ready: true, canonicalLauncherTemplateSha256: prepared.finalExecutionAuthority.canonicalLauncherTemplateSha256, canonicalSecureWrapperSourceSha256: base.canonicalSecureWrapperSourceSha256, secureWrapperRelativePath: path.basename(base.wrapperPath), secureWrapperSha256: hash(files[0]), materializationRelativePath: path.basename(materializationPath), materializationSha256: hash(files[1]), launcherBindingRelativePath: path.basename(bindingPath), launcherBindingSha256: hash(files[2]), renderedLauncherRelativePath: path.basename(launcherPath), renderedLauncherObservedSha256: hash(files[3]), executeApprovalSha256: prepared.finalExecutionAuthority.executeApprovalSha256, finalExecutionAuthoritySha256: hash(Buffer.from(JSON.stringify(prepared.finalExecutionAuthority))), expectedProjectRef: prepared.finalExecutionAuthority.expectedProjectRef, issuedAtUtc: new Date().toISOString() };
  let handle; try { handle = await open(readyPath, "wx", 0o600); await handle.writeFile(`${JSON.stringify(ready)}\n`); } finally { await handle?.close(); }
  return Object.freeze({ ...base, materializationPath, bindingPath, launcherPath, readyPath, materializationSha256: issuedMaterialization.sha256, launcherBindingSha256: issuedBinding.sha256, renderedLauncherObservedSha256: ready.renderedLauncherObservedSha256, ready: true });
}

export async function loadExternalExecutionMaterializationReadyV1({ externalRoot, readyInventoryPath }) {
  const root = path.resolve(externalRoot);
  const inventoryPath = contained(root, path.relative(root, path.resolve(readyInventoryPath)));
  const bytes = await readFile(inventoryPath).catch(() => fail("R6_PRODUCTION_RECONCILIATION_EXTERNAL_READY_MISSING"));
  let value; try { value = JSON.parse(bytes); } catch { fail("R6_PRODUCTION_RECONCILIATION_EXTERNAL_READY_INVALID"); }
  if (!value || Object.keys(value).length !== readyKeys.length || Object.keys(value).some(key => !readyKeys.includes(key)) || value.schemaVersion !== "r6-production-reconciliation-external-materialization-inventory-v1" || value.state !== "READY" || value.ready !== true || !/^[a-f0-9]{40}$/.test(String(value.sourceCommit)) || value.expectedProjectRef !== "xcbnxzjlsvtgzixurcof" || Number.isNaN(Date.parse(String(value.issuedAtUtc))) || ["canonicalLauncherTemplateSha256","canonicalSecureWrapperSourceSha256","secureWrapperSha256","materializationSha256","launcherBindingSha256","renderedLauncherObservedSha256","executeApprovalSha256","finalExecutionAuthoritySha256"].some(key => !HASH.test(String(value[key])))) fail("R6_PRODUCTION_RECONCILIATION_EXTERNAL_READY_INVALID");
  const paths = { wrapper: contained(root, value.secureWrapperRelativePath), materialization: contained(root, value.materializationRelativePath), binding: contained(root, value.launcherBindingRelativePath), launcher: contained(root, value.renderedLauncherRelativePath) };
  const artifactBytes = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key, file]) => [key, await readFile(file).catch(() => fail("R6_PRODUCTION_RECONCILIATION_EXTERNAL_READY_ARTIFACT_MISSING"))])));
  const observed = Object.fromEntries(Object.entries(artifactBytes).map(([key, bytes]) => [key, hash(bytes)]));
  if (observed.wrapper !== value.secureWrapperSha256 || observed.materialization !== value.materializationSha256 || observed.binding !== value.launcherBindingSha256 || observed.launcher !== value.renderedLauncherObservedSha256) fail("R6_PRODUCTION_RECONCILIATION_EXTERNAL_READY_BINDING_FAILED");
  const launcherAuthority = await loadCanonicalLauncherTemplateAuthority({ repositoryRoot: process.cwd() });
  const wrapperAuthority = await loadCanonicalSecureWrapperSourceAuthority({ repositoryRoot: process.cwd() });
  if (value.canonicalLauncherTemplateSha256 !== launcherAuthority.canonicalLauncherTemplateSha256 || value.canonicalSecureWrapperSourceSha256 !== wrapperAuthority.canonicalSecureWrapperSourceSha256) fail("R6_PRODUCTION_RECONCILIATION_EXTERNAL_READY_SOURCE_AUTHORITY_INVALID");
  let materialization, binding;
  try {
    materialization = validateExecutionMaterializationV2(JSON.parse(artifactBytes.materialization));
    binding = await validateLauncherBindingV3AgainstCanonicalTemplate({ value: JSON.parse(artifactBytes.binding), repositoryRoot: process.cwd() });
  } catch { fail("R6_PRODUCTION_RECONCILIATION_EXTERNAL_READY_ARTIFACT_INVALID"); }
  const launcherConfig = loadRenderedLauncherConfig(artifactBytes.launcher);
  if (binding.materializationPath !== paths.materialization || binding.launcherPath !== paths.launcher
    || binding.materializationSha256 !== observed.materialization || binding.executeApprovalSha256 !== materialization.executeApprovalSha256
    || binding.finalExecutionAuthoritySha256 !== materialization.finalExecutionAuthoritySha256 || binding.sourceCommit !== materialization.sourceCommit
    || binding.packageId !== materialization.packageId || binding.expectedProjectRef !== materialization.expectedProjectRef
    || binding.secureWrapperSha256 !== observed.wrapper || binding.canonicalLauncherTemplateSha256 !== materialization.canonicalLauncherTemplateSha256
    || launcherConfig.materializationPath !== paths.materialization || launcherConfig.launcherBindingPath !== paths.binding
    || path.resolve(launcherConfig.repositoryRoot ?? "") !== path.resolve(process.cwd())) fail("R6_PRODUCTION_RECONCILIATION_EXTERNAL_READY_LINEAGE_INVALID");
  return Object.freeze({ path: inventoryPath, sha256: hash(bytes), value, paths });
}
