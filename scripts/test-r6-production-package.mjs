import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateProductionAuthorization, validateProductionManifest } from "./qa/r6-production-package-contract.mjs";
import { validateProductionLauncherTerminal } from "./qa/validate-r6-production-launcher-terminal.mjs";
import { validateProductionLauncherBreadcrumb } from "./qa/validate-r6-production-launcher-breadcrumb.mjs";
import { createCanonicalCanaryTargetBinding } from "./qa/canonical-canary-target-binding.mjs";
import { getMinimalCanaryMutationPlan } from "./qa/r6-final-canary-execution-contract.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "r6-production-package-"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
try {
  const operatorRoot = path.join(root, "operator"); const evidenceRoot = path.join(root, "evidence"); const launcher = path.join(root, "launch-production.ps1"); const manifest = path.join(operatorRoot, "production-binding-manifest.json"); const authorization = path.join(operatorRoot, "production-authorization.json");
  const executionCommit = "a".repeat(40); const sourceRunId = "qa-canary-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; const sourceRoot = path.join(root, "source-evidence"); const sourceOperator = path.join(root, "source-operator"); const sourceManifestPath = path.join(sourceOperator, "dryrun-binding-manifest.json"); const receiptPath = path.join(sourceRoot, "receipt.json"); const authenticatedResultPath = path.join(sourceRoot, "auth.json"); const dryRunTerminalPath = path.join(sourceRoot, "dry-run.json"); const orchestrationTerminalPath = path.join(sourceRoot, "orchestration.json"); const targetBindingPath = path.join(sourceRoot, "target-binding.json");
  const plan = getMinimalCanaryMutationPlan(); const targetBinding = createCanonicalCanaryTargetBinding({ resolvedAtUtc: "2099-01-01T00:00:00.000Z", canonicalCircleId: "11111111-1111-4111-8111-111111111111", canonicalCircleSlug: "synthetic-target", baseMutationPlanSchema: plan.schemaVersion, baseMutationPlanHash: plan.planSha256, executionCommit, toolingCommit: executionCommit });
  await Promise.all([mkdir(sourceRoot, { recursive: true }), mkdir(sourceOperator, { recursive: true })]);
  await Promise.all([
    writeFile(receiptPath, JSON.stringify({ state: "CONSUMED", runId: sourceRunId, runnerCommit: executionCommit })),
    writeFile(authenticatedResultPath, JSON.stringify({ success: true })),
    writeFile(dryRunTerminalPath, JSON.stringify({ success: true, runId: sourceRunId, actualMutationCount: 0, supabaseWriteCount: 0, productionMutationCount: 0, retryCount: 0 })),
    writeFile(orchestrationTerminalPath, JSON.stringify({ success: true, runId: sourceRunId })),
    writeFile(targetBindingPath, JSON.stringify(targetBinding)),
  ]);
  const sourceManifest = { schemaVersion: "r6-fresh-dryrun-launcher-binding-v3", runId: sourceRunId, executionCommit, evidenceRoot: sourceRoot, receiptPath, authCheckTerminalPath: authenticatedResultPath, dryRunTerminalPath, orchestrationTerminalPath, targetBindingPath };
  await writeFile(sourceManifestPath, JSON.stringify(sourceManifest));
  const source = { manifestSchema: sourceManifest.schemaVersion, manifestPath: sourceManifestPath, manifestSha256: hash(await readFile(sourceManifestPath)), runId: sourceRunId, executionCommit, evidenceRoot: sourceRoot, receiptPath, receiptSha256: hash(await readFile(receiptPath)), authenticatedResultPath, authenticatedResultSha256: hash(await readFile(authenticatedResultPath)), dryRunTerminalPath, dryRunTerminalSha256: hash(await readFile(dryRunTerminalPath)), orchestrationTerminalPath, orchestrationTerminalSha256: hash(await readFile(orchestrationTerminalPath)), targetBindingPath, targetBindingSha256: hash(await readFile(targetBindingPath)), sourcePlanSchema: plan.schemaVersion, sourcePlanSha256: plan.planSha256, sameCommitBinding: true };
  const config = { runId: "qa-canary-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", executionCommit, branch: "feature/r6-current-canonical-production-identity-v1", executionWorktree: path.join(root, "detached"), wrapperPath: path.join(root, "wrapper.ps1"), wrapperSha256: "b".repeat(64), wranglerVersion: "4.106.0", wranglerEntrySha256: "c".repeat(64), evidenceRoot, operatorRoot, launcherTerminalPath: path.join(operatorRoot, "launcher-terminal-result.json"), launcherBreadcrumbPath: path.join(operatorRoot, "launcher-stage-breadcrumb.json"), executionTerminalPath: path.join(evidenceRoot, "final-canary-execution-terminal-result.json"), orchestrationTerminalPath: path.join(evidenceRoot, "final-canary-execute-and-postflight-orchestration-terminal-result.json"), postflightTerminalPath: path.join(evidenceRoot, "final-canary-read-only-postflight-terminal-result.json"), receiptPath: path.join(root, "receipts", "receipt.json"), journalPath: path.join(root, "journals", "journal.json"), confirmationSha256: hash("confirmation"), source };
  const configPath = path.join(root, "config.json"); await writeFile(configPath, JSON.stringify(config));
  const output = execFileSync(process.execPath, ["scripts/qa/issue-r6-production-package.mjs", "--config", configPath, "--launcher", launcher, "--manifest", manifest, "--authorization", authorization], { cwd: process.cwd(), encoding: "utf8" });
  assert.ok(JSON.parse(output).launcherSha256);
  const [manifestValue, authorizationValue] = await Promise.all([readFile(manifest, "utf8").then(JSON.parse), readFile(authorization, "utf8").then(JSON.parse)]);
  validateProductionManifest(manifestValue); validateProductionAuthorization(authorizationValue);
  const parser = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", launcher, "-ValidateOnly"], { encoding: "utf8" }); assert.equal(parser.status, 0); assert.match(parser.stdout, /R6_PRODUCTION_LAUNCH_VALIDATE_ONLY_READY/);
  const terminal = validateProductionLauncherTerminal(JSON.parse(await readFile(config.launcherTerminalPath, "utf8"))); assert.equal(terminal.success, true); assert.equal(terminal.wrapperStarted, false);
  const breadcrumb = validateProductionLauncherBreadcrumb(JSON.parse(await readFile(config.launcherBreadcrumbPath, "utf8"))); assert.equal(breadcrumb.runId, config.runId);
  assert.equal((await Promise.all([evidenceRoot, config.receiptPath, config.journalPath].map(async (item) => await import("node:fs/promises").then(({ stat }) => stat(item).then(() => true).catch(() => false))))).some(Boolean), false);
  console.log("R6_PRODUCTION_PACKAGE_PIPELINE_TEST_OK rendered launcher, manifest, authorization, and validate-only fixture passed with zero live operations");
} finally { await rm(root, { recursive: true, force: true }); }
