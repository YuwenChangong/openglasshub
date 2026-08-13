import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { loadFrozenDriftInputs, withProductionDriftFixtureRuntime, captureCatalog } from "./lib/production-drift-structural-fixture.mjs";
import { compareFingerprint } from "./compare-production-schema-fingerprint.mjs";
import { issueProductionReconciliationV4Package } from "./lib/r6-production-reconciliation-package-v4.mjs";
import { issueAttestedCandidateV3 } from "./lib/r6-production-reconciliation-candidate-issuer-v3.mjs";
import { issueExecutionBindingV2 } from "./lib/r6-production-reconciliation-execution-binding-v2.mjs";
import { issueExecuteApprovalV2 } from "./lib/r6-production-reconciliation-execute-approval-v2.mjs";
import { TARGET_PROBE_V2_SQL } from "./lib/r6-production-target-identity-v2.mjs";
import { executeOnce, finalizeHumanConfirmation, inspectNativePsqlCapability } from "./qa/r6-production-reconciliation-transport.mjs";

const root = process.cwd();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const confirmation = "local-transport-confirmation";
const launcherSha256 = hash("local-transport-launcher");
const docker = (args, input) => execFileSync("docker", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });
const dockerPsql = (container, sql, tupleOnly = false, discardOutput = false) => docker(["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", ...(tupleOnly ? ["-qAt"] : ["-q"]), ...(discardOutput ? ["-o", "/dev/null"] : []), "-U", "postgres", "-d", "postgres"], sql);

async function occupyDefaultPortIfAvailable() {
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen({ host: "127.0.0.1", port: 54322, exclusive: true }, resolve); });
    return Object.freeze({ server, ownedByTest: true });
  } catch (error) {
    if (error?.code === "EADDRINUSE") return Object.freeze({ server: null, ownedByTest: false });
    throw error;
  }
}

async function createPackage(temp) {
  const packageRoot = path.join(temp, "package");
  await issueProductionReconciliationV4Package({ packageRoot, repositoryRoot: root, implementationCommit: commit, launcherSha256, secureWrapperSha256: hash("local-secure-wrapper"), baselineSha256: "adec5b5933cc70869be55efbabb613b555c890f0e755e01b13b28696e67c9b4a" });
  return { packageRoot };
}

const temp = await mkdtemp(path.join(os.tmpdir(), "r6-production-transport-local-"));
const defaultPort = await occupyDefaultPortIfAvailable();
try {
  const packageFixture = await createPackage(temp);
  process.stdout.write("LOCAL_TRANSPORT_STAGE_01_FIXTURE_READY\n");
  const inputs = await loadFrozenDriftInputs(root);
  const result = await withProductionDriftFixtureRuntime({ root, inputs, label: "transport-local", run: async (runtime) => {
    process.stdout.write("LOCAL_TRANSPORT_STAGE_06_CHILD_STARTED\n");
    const capability = inspectNativePsqlCapability();
    const candidateRoot = path.join(temp, "candidate");
    const issued = await issueAttestedCandidateV3({ candidateRoot, packageRoot: packageFixture.packageRoot, repositoryRoot: root, transportImplementationCommit: commit, transportLauncherSha256: launcherSha256, transportSha256: hash("local-transport"), requiredConfirmationPhrase: confirmation, testOnly: true, testAuthorityRoot: path.join(temp, "authority") });
    assert.equal(issued.candidate.requiredConfirmationSha256, hash(confirmation));
    const authorizationPath = issued.candidateArtifact.path;
    const finalConfirmationPath = path.join(temp, "final-confirmation.json");
    const executionBindingPath = path.join(temp, "execution-binding-v2.json");
    await issueExecutionBindingV2({ outputPath: executionBindingPath, repositoryRoot: root, packageRoot: packageFixture.packageRoot, candidateRoot });
    const approvalPath = path.join(temp, "execute-v2.json");
    let targetConnections = 0;
    const client = {
      capability,
      async targetProbe(sql) { targetConnections += 1; return { outcome: "TARGET_SUCCESS", observedProbeOutput: dockerPsql(runtime.container, sql, true).trim() }; },
      async submitMigration(sql) { const process = spawnSync("docker", ["exec", "-i", runtime.container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q", "-U", "postgres", "-d", "postgres"], { input: Buffer.concat([Buffer.from("BEGIN;\n"), sql, Buffer.from("\nCOMMIT;\n")]), encoding: "utf8" }); return process.status === 0 ? { outcome: "COMMITTED" } : { outcome: "COMMIT_STATE_UNKNOWN" }; },
      async postflight(sql, { outputPath }) { dockerPsql(runtime.container, sql, false, true); await writeFile(outputPath, "local-postflight-executed\n"); return { outcome: "POSTFLIGHT_SUCCESS", comparison: { matchesExpected: true } }; },
    };
    await assert.rejects(issueExecuteApprovalV2({ outputPath: approvalPath, repositoryRoot: root, packageRoot: packageFixture.packageRoot, candidateRoot, finalConfirmationPath: path.join(temp, "missing.json"), executionBindingPath }), /R6_PRODUCTION_RECONCILIATION_FINAL_HUMAN_CONFIRMATION_REQUIRED/);
    assert.equal(targetConnections, 0, "candidate-only path must not open a target connection");
    const finalized = await finalizeHumanConfirmation({ authorizationPath, packageRoot: packageFixture.packageRoot, finalConfirmationPath, confirmationPhrase: confirmation, implementationCommit: commit, launcherSha256, transportSha256: hash("local-transport"), sqlClientCapability: capability });
    assert.equal(finalized.networkConnections, 0);
    await issueExecuteApprovalV2({ outputPath: approvalPath, repositoryRoot: root, packageRoot: packageFixture.packageRoot, candidateRoot, finalConfirmationPath, executionBindingPath });
    process.stdout.write("LOCAL_TRANSPORT_STAGE_07_ROUTING_READY\n");
    const execution = await executeOnce({ approvalPath, repositoryRoot: root, packageRoot: packageFixture.packageRoot, candidateRoot, finalConfirmationPath, executionBindingPath, receiptRoot: path.join(temp, "receipts"), evidenceRoot: path.join(temp, "evidence"), transportSha256: hash("local-transport"), environment: { PGHOST: "aws-1-ap-northeast-1.pooler.supabase.com", PGPORT: "5432", PGDATABASE: "postgres", PGUSER: "postgres.xcbnxzjlsvtgzixurcof" }, sqlClientCapability: capability, client });
    const catalog = await captureCatalog(root, runtime.container);
    return { execution, targetConnections, bootstrap: runtime.bootstrap, comparison: compareFingerprint(inputs.expected, catalog.rows).counts };
  }});
  assert.equal(result.execution.classification, "R6_PRODUCTION_RECONCILIATION_EXECUTION_AND_POSTFLIGHT_COMPLETE");
  assert.equal(result.targetConnections, 1); assert.equal(result.execution.postflightCount, 1); assert.deepEqual(result.comparison, { MATCH: 1133, MISSING_IN_PRODUCTION: 0, DIVERGENT_IN_PRODUCTION: 0, EXTRA_IN_PRODUCTION: 20, INSUFFICIENT_EVIDENCE: 0 });
  assert.notEqual(result.bootstrap.taskPortMap.postgres.hostPort, 54322, "task-owned bootstrap must not use the occupied default port");
  process.stdout.write("R6_PRODUCTION_RECONCILIATION_TRANSPORT_LOCAL_INTEGRATION_READY\n");
} finally {
  await rm(temp, { recursive: true, force: true });
  if (defaultPort.ownedByTest) await new Promise((resolve, reject) => defaultPort.server.close((error) => error ? reject(error) : resolve()));
}
