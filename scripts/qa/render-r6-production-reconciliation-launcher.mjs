import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCanonicalLauncherTemplateAuthority } from "../lib/r6-canonical-launcher-template-authority.mjs";
import { validateLauncherBindingV3AgainstCanonicalTemplate } from "../lib/r6-production-reconciliation-launcher-binding-v3.mjs";
import { validateExecutionMaterializationV2 } from "../lib/r6-production-reconciliation-materialization-v2.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = code => { throw Object.assign(new Error(code), { code }); };
const requiredText = (value, code) => typeof value === "string" && value.length > 0 ? value : fail(code);
const expectedKeys = ["repositoryRoot", "materializationPath", "launcherBindingPath", "transportPath", "transportSha256", "nodePath", "approvalPath", "packageRoot", "candidateRoot", "finalConfirmationPath", "executionBindingPath", "receiptRoot", "evidenceRoot"];

export async function renderProductionReconciliationLauncherV3({ config, destination }) {
  if (!config || typeof config !== "object" || Array.isArray(config) || Object.keys(config).length !== expectedKeys.length || expectedKeys.some(key => !(key in config))) fail("R6_PRODUCTION_RECONCILIATION_LAUNCHER_V3_RENDER_INPUT_INVALID");
  const resolved = Object.fromEntries(expectedKeys.map(key => [key, requiredText(config[key], "R6_PRODUCTION_RECONCILIATION_LAUNCHER_V3_RENDER_INPUT_INVALID")]));
  const repositoryRoot = path.resolve(resolved.repositoryRoot);
  const canonical = await loadCanonicalLauncherTemplateAuthority({ repositoryRoot });
  const materializationBytes = await readFile(path.resolve(resolved.materializationPath)).catch(() => fail("R6_PRODUCTION_RECONCILIATION_LAUNCHER_V3_MATERIALIZATION_MISSING"));
  let materialization;
  try { materialization = validateExecutionMaterializationV2(JSON.parse(materializationBytes)); } catch { fail("R6_PRODUCTION_RECONCILIATION_LAUNCHER_V3_MATERIALIZATION_INVALID"); }
  const bindingBytes = await readFile(path.resolve(resolved.launcherBindingPath)).catch(() => fail("R6_PRODUCTION_RECONCILIATION_LAUNCHER_V3_BINDING_MISSING"));
  let binding;
  try { binding = await validateLauncherBindingV3AgainstCanonicalTemplate({ value: JSON.parse(bindingBytes), repositoryRoot }); } catch { fail("R6_PRODUCTION_RECONCILIATION_LAUNCHER_V3_BINDING_INVALID"); }
  if (binding.materializationSha256 !== hash(materializationBytes)
    || binding.executeApprovalSha256 !== materialization.executeApprovalSha256
    || binding.finalExecutionAuthoritySha256 !== materialization.finalExecutionAuthoritySha256
    || binding.sourceCommit !== materialization.sourceCommit
    || binding.packageId !== materialization.packageId
    || binding.expectedProjectRef !== materialization.expectedProjectRef
    || binding.canonicalLauncherTemplateSha256 !== materialization.canonicalLauncherTemplateSha256
    || binding.canonicalLauncherTemplateSha256 !== canonical.canonicalLauncherTemplateSha256) fail("R6_PRODUCTION_RECONCILIATION_LAUNCHER_V3_LINEAGE_INVALID");
  resolved.routeAuthority = Object.freeze({ projectRef: materialization.expectedProjectRef, connectionMode: materialization.connectionMode, pgHost: materialization.pgHost, pgPort: materialization.pgPort, pgDatabase: materialization.pgDatabase, pgUser: materialization.pgUser });
  const template = await readFile(canonical.canonicalLauncherTemplatePath, "utf8");
  if (!template.includes("__CONFIG_BASE64__")) fail("R6_PRODUCTION_RECONCILIATION_LAUNCHER_V3_TEMPLATE_INVALID");
  const outputPath = path.resolve(destination);
  await mkdir(path.dirname(outputPath), { recursive: true });
  let handle;
  try {
    handle = await open(outputPath, "wx", 0o600);
    const renderedConfig = { ...resolved, materializationPath: path.resolve(resolved.materializationPath), launcherBindingPath: path.resolve(resolved.launcherBindingPath), transportPath: path.resolve(resolved.transportPath) };
    await handle.writeFile(template.replace("__CONFIG_BASE64__", Buffer.from(JSON.stringify(renderedConfig)).toString("base64")), "utf8");
  } catch (error) {
    if (error?.code === "EEXIST") fail("R6_PRODUCTION_RECONCILIATION_LAUNCHER_V3_DESTINATION_EXISTS");
    throw error;
  } finally { await handle?.close(); }
  return Object.freeze({ destination: outputPath, canonicalLauncherTemplateSha256: canonical.canonicalLauncherTemplateSha256, renderedLauncherRequiredForUpstreamAuthority: false });
}

const args = process.argv.slice(2);
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (args.length !== 4 || args[0] !== "--config" || args[2] !== "--destination") fail("R6_PRODUCTION_RECONCILIATION_LAUNCHER_V3_RENDER_INPUT_INVALID");
  const config = JSON.parse(await readFile(path.resolve(args[1]), "utf8"));
  await renderProductionReconciliationLauncherV3({ config, destination: args[3] });
}
