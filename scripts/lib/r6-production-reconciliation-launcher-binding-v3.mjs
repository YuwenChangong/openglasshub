import { loadCanonicalLauncherTemplateAuthority } from "./r6-canonical-launcher-template-authority.mjs";
import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { validateExecutionMaterializationV2 } from "./r6-production-reconciliation-materialization-v2.mjs";
export const LAUNCHER_BINDING_V3_VERSION = "r6-production-reconciliation-launcher-binding-v3";

const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const keys = ["schemaVersion","sourceCommit","packageId","materializationPath","materializationSha256","executeApprovalPath","executeApprovalSha256","finalExecutionAuthoritySchemaVersion","finalExecutionAuthoritySha256","launcherPath","canonicalLauncherTemplateSha256","secureWrapperSha256","expectedProjectRef","singleUse","immutable"];
const fail = code => { throw Object.assign(new Error(code), { code }); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

export function validateLauncherBindingV3(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))
    || value.schemaVersion !== LAUNCHER_BINDING_V3_VERSION || !COMMIT.test(String(value.sourceCommit)) || !/^[a-f0-9-]{36}$/.test(String(value.packageId))
    || !["materializationPath", "executeApprovalPath", "launcherPath"].every(key => typeof value[key] === "string" && value[key].length > 0)
    || value.finalExecutionAuthoritySchemaVersion !== "r6-production-reconciliation-final-execution-authority-v2"
    || value.expectedProjectRef !== "xcbnxzjlsvtgzixurcof" || value.singleUse !== true || value.immutable !== true
    || ["materializationSha256","executeApprovalSha256","finalExecutionAuthoritySha256","canonicalLauncherTemplateSha256","secureWrapperSha256"].some(key => !HASH.test(String(value[key])))) fail("R6_PRODUCTION_RECONCILIATION_LAUNCHER_BINDING_V3_INVALID");
  return Object.freeze({ ...value });
}

export async function validateLauncherBindingV3AgainstCanonicalTemplate({ value, repositoryRoot }) {
  const binding = validateLauncherBindingV3(value);
  const canonical = await loadCanonicalLauncherTemplateAuthority({ repositoryRoot });
  if (binding.canonicalLauncherTemplateSha256 !== canonical.canonicalLauncherTemplateSha256) fail("R6_PRODUCTION_RECONCILIATION_LAUNCHER_BINDING_V3_CANONICAL_TEMPLATE_MISMATCH");
  return binding;
}

export async function issueLauncherBindingV3({ outputPath, materializationPath, externalSecureWrapperPath, launcherPath, finalExecutionAuthority, repositoryRoot }) {
  const materializationBytes = await readFile(materializationPath).catch(() => fail("R6_PRODUCTION_RECONCILIATION_LAUNCHER_BINDING_V3_MATERIALIZATION_MISSING"));
  let materialization; try { materialization = validateExecutionMaterializationV2(JSON.parse(materializationBytes)); } catch { fail("R6_PRODUCTION_RECONCILIATION_LAUNCHER_BINDING_V3_MATERIALIZATION_INVALID"); }
  const wrapperBytes = await readFile(externalSecureWrapperPath).catch(() => fail("R6_PRODUCTION_RECONCILIATION_LAUNCHER_BINDING_V3_SECURE_WRAPPER_MISSING"));
  const canonical = await loadCanonicalLauncherTemplateAuthority({ repositoryRoot });
  if (!finalExecutionAuthority || finalExecutionAuthority.schemaVersion !== "r6-production-reconciliation-final-execution-authority-v2" || finalExecutionAuthority.executeApprovalSha256 !== materialization.executeApprovalSha256 || finalExecutionAuthority.canonicalLauncherTemplateSha256 !== canonical.canonicalLauncherTemplateSha256 || materialization.canonicalLauncherTemplateSha256 !== canonical.canonicalLauncherTemplateSha256 || materialization.secureWrapperSha256 !== hash(wrapperBytes)) fail("R6_PRODUCTION_RECONCILIATION_LAUNCHER_BINDING_V3_UPSTREAM_INVALID");
  const value = validateLauncherBindingV3({ schemaVersion: LAUNCHER_BINDING_V3_VERSION, sourceCommit: materialization.sourceCommit, packageId: materialization.packageId, materializationPath, materializationSha256: hash(materializationBytes), executeApprovalPath: "bound-by-materialization", executeApprovalSha256: materialization.executeApprovalSha256, finalExecutionAuthoritySchemaVersion: finalExecutionAuthority.schemaVersion, finalExecutionAuthoritySha256: hash(Buffer.from(JSON.stringify(finalExecutionAuthority))), launcherPath, canonicalLauncherTemplateSha256: canonical.canonicalLauncherTemplateSha256, secureWrapperSha256: hash(wrapperBytes), expectedProjectRef: materialization.expectedProjectRef, singleUse: true, immutable: true });
  let handle; try { handle = await open(outputPath, "wx", 0o600); const bytes = Buffer.from(`${JSON.stringify(value)}\n`); await handle.writeFile(bytes); await handle.close(); handle = null; return await loadLauncherBindingV3({ bindingPath: outputPath, materializationPath, externalSecureWrapperPath, finalExecutionAuthority, repositoryRoot }); } catch (error) { if (error?.code === "EEXIST") fail("R6_PRODUCTION_RECONCILIATION_LAUNCHER_BINDING_V3_REPLAY"); throw error; } finally { await handle?.close(); }
}

export async function loadLauncherBindingV3({ bindingPath, materializationPath, externalSecureWrapperPath, finalExecutionAuthority, repositoryRoot }) {
  const bytes = await readFile(bindingPath).catch(() => fail("R6_PRODUCTION_RECONCILIATION_LAUNCHER_BINDING_V3_MISSING"));
  let value; try { value = await validateLauncherBindingV3AgainstCanonicalTemplate({ value: JSON.parse(bytes), repositoryRoot }); } catch { fail("R6_PRODUCTION_RECONCILIATION_LAUNCHER_BINDING_V3_INVALID"); }
  const materializationBytes = await readFile(materializationPath).catch(() => fail("R6_PRODUCTION_RECONCILIATION_LAUNCHER_BINDING_V3_MATERIALIZATION_MISSING"));
  const materialization = validateExecutionMaterializationV2(JSON.parse(materializationBytes));
  const wrapperSha256 = hash(await readFile(externalSecureWrapperPath).catch(() => fail("R6_PRODUCTION_RECONCILIATION_LAUNCHER_BINDING_V3_SECURE_WRAPPER_MISSING")));
  if (value.materializationSha256 !== hash(materializationBytes) || value.executeApprovalSha256 !== materialization.executeApprovalSha256 || value.secureWrapperSha256 !== wrapperSha256 || value.sourceCommit !== materialization.sourceCommit || value.packageId !== materialization.packageId || value.expectedProjectRef !== materialization.expectedProjectRef || value.finalExecutionAuthoritySha256 !== hash(Buffer.from(JSON.stringify(finalExecutionAuthority)))) fail("R6_PRODUCTION_RECONCILIATION_LAUNCHER_BINDING_V3_BINDING_FAILED");
  return Object.freeze({ path: bindingPath, sha256: hash(bytes), value });
}
