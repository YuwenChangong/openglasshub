import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { validateDryRunAuthorization } from "./r6-final-canary-execution-contract.mjs";
import { validateFinalExecutionBinding } from "./r6-final-execution-binding.mjs";

export const PRIMARY_BINDING_FILE = "final-execution-binding.json";
export const REISSUE_BINDING_FILE = "final-execution-binding-reissue-v1.json";
export const REISSUE_TERMINAL_FILE = "final-execution-binding-reissue-terminal.json";
export const REISSUE_TERMINAL_VERSION = "r6-final-execution-binding-reissue-terminal-v1";
export const REISSUE_READY_CLASSIFICATION = "R6_FINAL_EXECUTION_BINDING_CANONICAL_REISSUE_READY";
export const PARENT_SAME_COMMIT_READY = "R6_FINAL_PARENT_DRYRUN_SAME_COMMIT_BINDING_READY";

const SHA256 = /^[a-f0-9]{64}$/;
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function absoluteOperatorRoot(value) {
  const root = path.resolve(String(value ?? ""));
  if (!path.isAbsolute(root)) fail("R6_FINAL_EXECUTION_BINDING_OPERATOR_ROOT_INVALID");
  return root;
}

function exact(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) fail(code);
}

export function finalExecutionBindingPaths(operatorRoot) {
  const root = absoluteOperatorRoot(operatorRoot);
  return Object.freeze({
    operatorRoot: root,
    primary: path.join(root, PRIMARY_BINDING_FILE),
    replacement: path.join(root, REISSUE_BINDING_FILE),
    terminal: path.join(root, REISSUE_TERMINAL_FILE),
  });
}

export function validateKnownInvalidPrimaryBinding(value, expectedSha256) {
  if (!SHA256.test(String(expectedSha256))) fail("R6_FINAL_EXECUTION_BINDING_REISSUE_PRIMARY_SHA_INVALID");
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("R6_FINAL_EXECUTION_BINDING_REISSUE_PRIMARY_INVALID");
  const canonical = { ...value };
  if (!("bindingSha256" in canonical) || !SHA256.test(String(canonical.bindingSha256))) fail("R6_FINAL_EXECUTION_BINDING_REISSUE_PRIMARY_INVALID");
  delete canonical.bindingSha256;
  try { validateFinalExecutionBinding(value); fail("R6_FINAL_EXECUTION_BINDING_REISSUE_PRIMARY_ALREADY_VALID"); }
  catch (error) { if (error?.code !== "R6_FINAL_EXECUTION_BINDING_INVALID") throw error; }
  try { validateFinalExecutionBinding(canonical); }
  catch { fail("R6_FINAL_EXECUTION_BINDING_REISSUE_PRIMARY_INVALID"); }
  if (Object.keys(value).length !== Object.keys(canonical).length + 1 || canonical.bindingSha256 !== undefined || sha256(JSON.stringify(canonical)) !== value.bindingSha256) fail("R6_FINAL_EXECUTION_BINDING_REISSUE_PRIMARY_INVALID");
  return Object.freeze({ canonical, failureClassification: "R6_FINAL_EXECUTION_BINDING_INVALID", failureReasonCode: "unexpected_field_bindingSha256" });
}

async function requireFile(file, code) {
  try { await access(file); } catch { fail(code); }
}

async function absent(file, code) {
  try { await access(file); fail(code); } catch (error) { if (error?.code !== "ENOENT") throw error; }
}

export async function inspectKnownInvalidPrimary({ operatorRoot, expectedPrimarySha256, finalAuthorizationPath, expectedFinalAuthorizationSha256, executionCommit }) {
  const paths = finalExecutionBindingPaths(operatorRoot);
  await requireFile(paths.primary, "R6_FINAL_EXECUTION_BINDING_REISSUE_PRIMARY_MISSING");
  const [primaryRaw, authorizationRaw] = await Promise.all([readFile(paths.primary), readFile(finalAuthorizationPath)]);
  const primarySha256 = sha256(primaryRaw);
  if (primarySha256 !== expectedPrimarySha256) fail("R6_FINAL_EXECUTION_BINDING_REISSUE_PRIMARY_SHA_INVALID");
  if (sha256(authorizationRaw) !== expectedFinalAuthorizationSha256) fail("R6_FINAL_EXECUTION_BINDING_REISSUE_AUTHORIZATION_SHA_INVALID");
  let primary;
  try { primary = JSON.parse(primaryRaw.toString("utf8")); } catch { fail("R6_FINAL_EXECUTION_BINDING_REISSUE_PRIMARY_INVALID"); }
  const known = validateKnownInvalidPrimaryBinding(primary, primarySha256);
  let authorization;
  try { authorization = JSON.parse(authorizationRaw.toString("utf8")); validateDryRunAuthorization(authorization, { executionCommit, toolingCommit: executionCommit }); }
  catch { fail("R6_FINAL_EXECUTION_BINDING_REISSUE_AUTHORIZATION_INVALID"); }
  if (known.canonical.parentAuthorizationPath !== path.resolve(finalAuthorizationPath) || known.canonical.parentAuthorizationSha256 !== expectedFinalAuthorizationSha256 || known.canonical.executionCommit !== executionCommit) fail("R6_FINAL_EXECUTION_BINDING_REISSUE_PARENT_MISMATCH");
  await absent(paths.replacement, "R6_FINAL_EXECUTION_BINDING_REISSUE_ALREADY_EXISTS");
  await absent(paths.terminal, "R6_FINAL_EXECUTION_BINDING_REISSUE_ALREADY_EXISTS");
  return Object.freeze({ paths, primarySha256, authorization, known });
}

export function validateReissueTerminal(value) {
  const keys = ["schemaVersion", "runId", "classification", "issuedAt", "primaryInvalidBindingPath", "primaryInvalidBindingSha256", "primaryFailureClassification", "primaryFailureReasonCode", "replacementBindingPath", "replacementBindingSha256", "replacementBindingSchema", "finalAuthorizationPath", "finalAuthorizationSha256", "parentExecutionCommit", "issuerImplementationCommit", "strictValidationClassification", "parentSameCommitClassification"];
  exact(value, keys, "R6_FINAL_EXECUTION_BINDING_REISSUE_TERMINAL_INVALID");
  if (value.schemaVersion !== REISSUE_TERMINAL_VERSION || !/^qa-canary-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(value.runId)) || value.classification !== REISSUE_READY_CLASSIFICATION || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(String(value.issuedAt)) || value.primaryFailureClassification !== "R6_FINAL_EXECUTION_BINDING_INVALID" || value.primaryFailureReasonCode !== "unexpected_field_bindingSha256" || value.replacementBindingSchema !== "r6-final-execution-binding-v2" || value.strictValidationClassification !== "R6_FINAL_EXECUTION_BINDING_STRICT_VALID" || value.parentSameCommitClassification !== PARENT_SAME_COMMIT_READY || !SHA256.test(String(value.primaryInvalidBindingSha256)) || !SHA256.test(String(value.replacementBindingSha256)) || !SHA256.test(String(value.finalAuthorizationSha256)) || !/^[a-f0-9]{40}$/.test(String(value.parentExecutionCommit)) || !/^[a-f0-9]{40}$/.test(String(value.issuerImplementationCommit))) fail("R6_FINAL_EXECUTION_BINDING_REISSUE_TERMINAL_INVALID");
  return Object.freeze({ ...value });
}

export function validateParentSameCommitBinding({ binding, parentAuthorization, parentReceipt, executionCommit, parentAuthorizationPath, parentAuthorizationSha256, parentReceiptPath, parentReceiptSha256 }) {
  const item = validateFinalExecutionBinding(binding);
  const authorization = validateDryRunAuthorization(parentAuthorization, { executionCommit, toolingCommit: executionCommit, expectedDryRunRunId: item.parentDryRunRunId });
  if (item.executionCommit !== executionCommit || item.runnerCommit !== executionCommit || item.toolingCommit !== executionCommit || item.parentAuthorizationPath !== path.resolve(parentAuthorizationPath) || item.parentAuthorizationSha256 !== parentAuthorizationSha256 || item.parentReceiptPath !== path.resolve(parentReceiptPath) || item.parentReceiptSha256 !== parentReceiptSha256 || parentReceipt?.state !== "CONSUMED" || parentReceipt?.runId !== item.parentDryRunRunId || parentReceipt?.runnerCommit !== executionCommit || authorization.dryRunReceiptPath !== item.parentReceiptPath || authorization.dryRunReceiptSha256 !== item.parentReceiptSha256 || authorization.executionCommit !== executionCommit || authorization.toolingCommit !== executionCommit || authorization.plan.planSha256 !== item.planSha256 || JSON.stringify(authorization.targetBinding) !== JSON.stringify(item.targetBinding)) fail("R6_FINAL_PARENT_DRYRUN_SAME_COMMIT_BINDING_INVALID");
  return Object.freeze({ classification: PARENT_SAME_COMMIT_READY, parentExecutionCommit: executionCommit, runId: item.parentDryRunRunId });
}

export async function readFinalExecutionBindingForReview({ operatorRoot, expectedExecutionCommit, expectedParentAuthorizationPath, expectedParentAuthorizationSha256 }) {
  const paths = finalExecutionBindingPaths(operatorRoot);
  await requireFile(paths.primary, "R6_FINAL_EXECUTION_BINDING_REQUIRED");
  const [primaryRaw, authorizationRaw] = await Promise.all([readFile(paths.primary), readFile(expectedParentAuthorizationPath)]);
  if (sha256(authorizationRaw) !== expectedParentAuthorizationSha256) fail("R6_FINAL_EXECUTION_BINDING_PARENT_MISMATCH");
  let authorization;
  try { authorization = JSON.parse(authorizationRaw.toString("utf8")); } catch { fail("R6_FINAL_EXECUTION_BINDING_PARENT_MISMATCH"); }
  try {
    const binding = validateFinalExecutionBinding(JSON.parse(primaryRaw.toString("utf8")));
    await absent(paths.replacement, "R6_FINAL_EXECUTION_BINDING_MULTIPLE_REPLACEMENTS");
    await absent(paths.terminal, "R6_FINAL_EXECUTION_BINDING_MULTIPLE_REPLACEMENTS");
    if (binding.executionCommit !== expectedExecutionCommit || binding.parentAuthorizationPath !== path.resolve(expectedParentAuthorizationPath) || binding.parentAuthorizationSha256 !== expectedParentAuthorizationSha256) fail("R6_FINAL_EXECUTION_BINDING_PARENT_MISMATCH");
    const receiptRaw = await readFile(binding.parentReceiptPath);
    const sameCommit = validateParentSameCommitBinding({ binding, parentAuthorization: authorization, parentReceipt: JSON.parse(receiptRaw.toString("utf8")), executionCommit: expectedExecutionCommit, parentAuthorizationPath: expectedParentAuthorizationPath, parentAuthorizationSha256: expectedParentAuthorizationSha256, parentReceiptPath: binding.parentReceiptPath, parentReceiptSha256: sha256(receiptRaw) });
    return Object.freeze({ binding, bindingPath: paths.primary, bindingSha256: sha256(primaryRaw), selection: "primary", parentSameCommitClassification: sameCommit.classification });
  } catch (error) {
    if (error?.code !== "R6_FINAL_EXECUTION_BINDING_INVALID") throw error;
  }
  const known = validateKnownInvalidPrimaryBinding(JSON.parse(primaryRaw.toString("utf8")), sha256(primaryRaw));
  const candidates = (await readdir(paths.operatorRoot)).filter((name) => /^final-execution-binding-reissue-v\d+\.json$/i.test(name));
  if (candidates.length !== 1 || candidates[0] !== REISSUE_BINDING_FILE) fail("R6_FINAL_EXECUTION_BINDING_REISSUE_SELECTION_INVALID");
  await requireFile(paths.terminal, "R6_FINAL_EXECUTION_BINDING_REISSUE_TERMINAL_REQUIRED");
  const [replacementRaw, terminalRaw] = await Promise.all([readFile(paths.replacement), readFile(paths.terminal)]);
  const binding = validateFinalExecutionBinding(JSON.parse(replacementRaw.toString("utf8")));
  const terminal = validateReissueTerminal(JSON.parse(terminalRaw.toString("utf8")));
  const receiptRaw = await readFile(binding.parentReceiptPath);
  const sameCommit = validateParentSameCommitBinding({ binding, parentAuthorization: authorization, parentReceipt: JSON.parse(receiptRaw.toString("utf8")), executionCommit: expectedExecutionCommit, parentAuthorizationPath: expectedParentAuthorizationPath, parentAuthorizationSha256: expectedParentAuthorizationSha256, parentReceiptPath: binding.parentReceiptPath, parentReceiptSha256: sha256(receiptRaw) });
  if (terminal.primaryInvalidBindingPath !== paths.primary || terminal.primaryInvalidBindingSha256 !== sha256(primaryRaw) || terminal.replacementBindingPath !== paths.replacement || terminal.replacementBindingSha256 !== sha256(replacementRaw) || terminal.runId !== binding.parentDryRunRunId || terminal.finalAuthorizationPath !== path.resolve(expectedParentAuthorizationPath) || terminal.finalAuthorizationSha256 !== expectedParentAuthorizationSha256 || terminal.parentExecutionCommit !== expectedExecutionCommit || binding.executionCommit !== expectedExecutionCommit || binding.parentAuthorizationPath !== path.resolve(expectedParentAuthorizationPath) || binding.parentAuthorizationSha256 !== expectedParentAuthorizationSha256 || known.failureReasonCode !== terminal.primaryFailureReasonCode || sameCommit.classification !== terminal.parentSameCommitClassification) fail("R6_FINAL_EXECUTION_BINDING_REISSUE_BINDING_MISMATCH");
  return Object.freeze({ binding, bindingPath: paths.replacement, bindingSha256: sha256(replacementRaw), selection: "reissue", primaryInvalidBindingSha256: sha256(primaryRaw), parentSameCommitClassification: sameCommit.classification });
}
