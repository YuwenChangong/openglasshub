import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProductionAuthorization, createProductionManifest, sha256 } from "./r6-production-package-contract.mjs";
import { getMinimalCanaryMutationPlan } from "./r6-final-canary-execution-contract.mjs";
import { validateCanonicalCanaryTargetBinding } from "./canonical-canary-target-binding.mjs";

const args = process.argv.slice(2);
if (args.length !== 8 || args[0] !== "--config" || args[2] !== "--launcher" || args[4] !== "--manifest" || args[6] !== "--authorization") throw new Error("R6_PRODUCTION_PACKAGE_ISSUE_INPUT_INVALID");
const config = JSON.parse(await readFile(path.resolve(args[1]), "utf8"));
const launcher = path.resolve(args[3]); const manifestPath = path.resolve(args[5]); const authorizationPath = path.resolve(args[7]);
for (const candidate of [config.operatorRoot, config.evidenceRoot, launcher, manifestPath, authorizationPath]) { try { await access(candidate); throw new Error("R6_PRODUCTION_PACKAGE_SINGLE_USE_PATH_CONFLICT"); } catch (error) { if (error?.code !== "ENOENT") throw error; } }
if (path.resolve(path.dirname(manifestPath)) !== path.resolve(config.operatorRoot) || path.resolve(path.dirname(authorizationPath)) !== path.resolve(config.operatorRoot)) throw new Error("R6_PRODUCTION_PACKAGE_OPERATOR_ROOT_INVALID");

async function readBoundJson(file, expectedSha256, code) {
  const bytes = await readFile(file).catch(() => { throw new Error(code); });
  if (sha256(bytes) !== expectedSha256) throw new Error(code);
  try { return JSON.parse(bytes.toString("utf8")); } catch { throw new Error(code); }
}

async function validateExecutedDryRunSource(source, executionCommit) {
  const plan = getMinimalCanaryMutationPlan();
  const manifest = await readBoundJson(source.manifestPath, source.manifestSha256, "R6_PRODUCTION_PACKAGE_SOURCE_MANIFEST_INVALID");
  const expectedPaths = ["evidenceRoot", "receiptPath", "authCheckTerminalPath", "dryRunTerminalPath", "orchestrationTerminalPath", "targetBindingPath"];
  if (manifest.schemaVersion !== "r6-fresh-dryrun-launcher-binding-v3" || manifest.runId !== source.runId || manifest.executionCommit !== executionCommit || manifest.evidenceRoot !== source.evidenceRoot || expectedPaths.some((key) => typeof manifest[key] !== "string")) throw new Error("R6_PRODUCTION_PACKAGE_SOURCE_MANIFEST_INVALID");
  const [receipt, authenticated, dryRun, orchestration, targetBinding] = await Promise.all([
    readBoundJson(source.receiptPath, source.receiptSha256, "R6_PRODUCTION_PACKAGE_SOURCE_RECEIPT_INVALID"),
    readBoundJson(source.authenticatedResultPath, source.authenticatedResultSha256, "R6_PRODUCTION_PACKAGE_SOURCE_AUTH_INVALID"),
    readBoundJson(source.dryRunTerminalPath, source.dryRunTerminalSha256, "R6_PRODUCTION_PACKAGE_SOURCE_DRY_RUN_INVALID"),
    readBoundJson(source.orchestrationTerminalPath, source.orchestrationTerminalSha256, "R6_PRODUCTION_PACKAGE_SOURCE_ORCHESTRATION_INVALID"),
    readBoundJson(source.targetBindingPath, source.targetBindingSha256, "R6_PRODUCTION_PACKAGE_SOURCE_TARGET_INVALID"),
  ]);
  if (receipt.state !== "CONSUMED" || receipt.runId !== source.runId || receipt.runnerCommit !== executionCommit || authenticated.success !== true || dryRun.success !== true || orchestration.success !== true || dryRun.runId !== source.runId || orchestration.runId !== source.runId || dryRun.actualMutationCount !== 0 || dryRun.supabaseWriteCount !== 0 || dryRun.productionMutationCount !== 0 || dryRun.retryCount !== 0) throw new Error("R6_PRODUCTION_PACKAGE_SOURCE_EXECUTION_INVALID");
  validateCanonicalCanaryTargetBinding(targetBinding, { baseMutationPlanSchema: plan.schemaVersion, baseMutationPlanHash: plan.planSha256, executionCommit, toolingCommit: executionCommit });
  if (source.sourcePlanSchema !== plan.schemaVersion || source.sourcePlanSha256 !== plan.planSha256 || source.sameCommitBinding !== true) throw new Error("R6_PRODUCTION_PACKAGE_SOURCE_BINDING_INVALID");
}

await validateExecutedDryRunSource(config.source, config.executionCommit);
config.launcherPath = launcher; config.manifestPath = manifestPath; config.authorizationPath = authorizationPath;
const renderConfig = path.join(path.dirname(config.operatorRoot), `.r6-production-render-${process.pid}.json`);
await mkdir(path.dirname(launcher), { recursive: true }); await writeFile(renderConfig, JSON.stringify(config), "utf8");
try {
  execFileSync(process.execPath, [fileURLToPath(new URL("./render-r6-production-launcher.mjs", import.meta.url)), "--config", renderConfig, "--destination", launcher], { stdio: "pipe" });
  const launcherSha256 = createHash("sha256").update(await readFile(launcher)).digest("hex");
  const manifest = createProductionManifest({ ...config, launcherSha256 });
  await mkdir(config.operatorRoot, { recursive: false }); await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const manifestSha256 = createHash("sha256").update(await readFile(manifestPath)).digest("hex");
  const authorization = createProductionAuthorization(manifest, manifestSha256);
  await writeFile(authorizationPath, `${JSON.stringify(authorization, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ launcher, manifest: manifestPath, authorization: authorizationPath, launcherSha256, manifestSha256, authorizationSha256: createHash("sha256").update(await readFile(authorizationPath)).digest("hex") })}\n`);
} finally { await import("node:fs/promises").then(({ rm }) => rm(renderConfig, { force: true })); }
