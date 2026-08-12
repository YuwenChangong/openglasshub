import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { issueExecutionBindingV2, loadExecutionBindingV2 } from "./lib/r6-production-reconciliation-execution-binding-v2.mjs";
import { buildExecuteApprovalV2 } from "./lib/r6-production-reconciliation-execute-approval-v2.mjs";
import { createLocalR6ProductionReconciliationAuthorityFixture } from "./test-support/r6-production-reconciliation-local-authority-fixture.mjs";

const repositoryRoot = process.cwd();
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
const roots = [];
const fixture = async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "r6-binding-v2-"));
  roots.push(tempRoot);
  return createLocalR6ProductionReconciliationAuthorityFixture({ tempRoot, repositoryRoot, sourceCommit });
};

try {
  const valid = await fixture();
  const original = await readFile(valid.executionBindingPath);
  const loaded = await loadExecutionBindingV2({ repositoryRoot, packageRoot: valid.packageRoot, candidateRoot: valid.candidateRoot, executionBindingPath: valid.executionBindingPath });
  assert.equal(loaded.bytes.equals(original), true);
  assert.equal(loaded.sha256.length, 64);
  await assert.rejects(
    () => issueExecutionBindingV2({ outputPath: valid.executionBindingPath, repositoryRoot, packageRoot: valid.packageRoot, candidateRoot: valid.candidateRoot }),
    /EXECUTION_BINDING_V2_REPLAY/,
  );
  assert.equal((await readFile(valid.executionBindingPath)).equals(original), true);

  const other = await fixture();
  await assert.rejects(
    () => loadExecutionBindingV2({ repositoryRoot, packageRoot: other.packageRoot, candidateRoot: valid.candidateRoot, executionBindingPath: valid.executionBindingPath }),
    /EXECUTION_BINDING_V2_UPSTREAM_BINDING_FAILED|EXECUTION_BINDING_V2_BINDING_FAILED/,
  );
  await assert.rejects(
    () => loadExecutionBindingV2({ repositoryRoot, packageRoot: valid.packageRoot, candidateRoot: other.candidateRoot, executionBindingPath: valid.executionBindingPath }),
    /EXECUTION_BINDING_V2_UPSTREAM_BINDING_FAILED|EXECUTION_BINDING_V2_BINDING_FAILED/,
  );

  await writeFile(valid.executionBindingPath, "{\n");
  await assert.rejects(
    () => loadExecutionBindingV2({ repositoryRoot, packageRoot: valid.packageRoot, candidateRoot: valid.candidateRoot, executionBindingPath: valid.executionBindingPath }),
    /EXECUTION_BINDING_INVALID/,
  );
  await writeFile(valid.executionBindingPath, original);
  const tampered = JSON.parse(original); tampered.launcherSha256 = "0".repeat(64);
  await writeFile(valid.executionBindingPath, `${JSON.stringify(tampered)}\n`);
  await assert.rejects(
    () => loadExecutionBindingV2({ repositoryRoot, packageRoot: valid.packageRoot, candidateRoot: valid.candidateRoot, executionBindingPath: valid.executionBindingPath }),
    /EXECUTION_BINDING_V2_BINDING_FAILED/,
  );
  await writeFile(valid.executionBindingPath, original);
  const wrongProject = JSON.parse(original); wrongProject.expectedProjectRef = "aaaaaaaaaaaaaaaaaaaa";
  await writeFile(valid.executionBindingPath, `${JSON.stringify(wrongProject)}\n`);
  await assert.rejects(
    () => loadExecutionBindingV2({ repositoryRoot, packageRoot: valid.packageRoot, candidateRoot: valid.candidateRoot, executionBindingPath: valid.executionBindingPath }),
    /EXECUTION_BINDING_V2_BINDING_FAILED/,
  );
  await writeFile(valid.executionBindingPath, original);
  const candidatePath = path.join(valid.candidateRoot, "production-reconciliation-candidate.json");
  const candidateBytes = await readFile(candidatePath);
  const wrongSource = JSON.parse(candidateBytes); wrongSource.transportImplementationCommit = "0".repeat(40);
  await writeFile(candidatePath, `${JSON.stringify(wrongSource)}\n`);
  await assert.rejects(
    () => loadExecutionBindingV2({ repositoryRoot, packageRoot: valid.packageRoot, candidateRoot: valid.candidateRoot, executionBindingPath: valid.executionBindingPath }),
    /CANDIDATE_AUTHORITY_TERMINAL_BINDING_INVALID/,
  );
  await writeFile(candidatePath, candidateBytes);

  await unlink(valid.executionBindingPath);
  await assert.rejects(
    () => buildExecuteApprovalV2({ repositoryRoot, ...valid }),
    /EXECUTION_BINDING_MISSING/,
  );
  console.log("R6_PRODUCTION_RECONCILIATION_EXECUTION_BINDING_V2_ISSUER_PASS");
} finally {
  await Promise.all(roots.map(tempRoot => rm(tempRoot, { recursive: true, force: true })));
}
