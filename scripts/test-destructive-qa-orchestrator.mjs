import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRunManifest,
  orchestrateDestructiveQa,
  registerArtifact,
  serializeManifest,
} from "./qa/destructive-qa-orchestrator.mjs";

const runId = "qa-run-v2-12345";
const previewRef = "stagingguard123";
const productionRef = "productionguard123";
const stagingUrl = `https://${previewRef}.supabase.co`;
const productionUrl = `https://${productionRef}.supabase.co`;
const secretSentinel = "super-secret-value-must-not-print";
const hookDirectory = mkdtempSync(join(tmpdir(), "openglass-orchestrator-no-network-"));
const hookPath = join(hookDirectory, "block-network.cjs");

writeFileSync(hookPath, [
  "const fail = () => { throw new Error('QA_TEST_NETWORK_BLOCKED'); };",
  "global.fetch = fail;",
  "require('node:http').request = fail;",
  "require('node:https').request = fail;",
  "require('node:net').connect = fail;",
].join("\n"));

const methodByGroup = {
  users: "deleteUserByExactId",
  profiles: "deleteProfileByExactId",
  roleAssignments: "revokeRoleByExactUserId",
  posts: "deletePostById",
  comments: "deleteCommentById",
  circles: "deleteCircleById",
  reports: "deleteReportById",
  mediaObjects: "deleteMediaByExactKey",
  relationshipRows: "deleteRelationshipRowById",
};

class FakeAdapter {
  constructor(options = {}) {
    this.options = options;
    this.records = new Map();
    this.calls = [];
  }

  create(group, step) {
    this.calls.push(step);
    if (this.options.failAt === step) throw new Error(`FAIL_${step}`);
    const actualId = `${group}-${runId}`;
    this.records.set(`${group}:${actualId}`, true);
    return { id: this.options.wrongIdAt === step ? `wrong-${actualId}` : actualId, publicRoute: `/${group}/${actualId}/` };
  }

  createQaUser() {
    const user = this.create("users", "createQaUser");
    const profileId = `profiles-${runId}`;
    this.records.set(`profiles:${profileId}`, true);
    return { ...user, profileId };
  }
  assignQaRole() { return this.create("roleAssignments", "assignQaRole"); }
  createCircle() { return this.create("circles", "createCircle"); }
  createPost() { return this.create("posts", "createPost"); }
  createComment() { return this.create("comments", "createComment"); }
  createRelationshipRow() { return this.create("relationshipRows", "createRelationshipRow"); }
  createReport() { return this.create("reports", "createReport"); }
  uploadMedia() { return this.create("mediaObjects", "uploadMedia"); }

  async assertQaScenario() {
    this.calls.push("assertQaScenario");
    if (this.options.failAt === "assertQaScenario") throw new Error("FAIL_assertQaScenario");
  }

  delete(group, method, id) {
    this.calls.push(method);
    if (this.options.failAt === method) throw new Error(`FAIL_${method}`);
    const key = `${group}:${id}`;
    if (!this.records.has(key)) return { ok: true, alreadyAbsent: true };
    this.records.delete(key);
    return { ok: true };
  }

  deleteUserByExactId(id) { return this.delete("users", "deleteUserByExactId", id); }
  deleteProfileByExactId(id) { return this.delete("profiles", "deleteProfileByExactId", id); }
  revokeRoleByExactUserId(id) { return this.delete("roleAssignments", "revokeRoleByExactUserId", id); }
  deletePostById(id) { return this.delete("posts", "deletePostById", id); }
  deleteCommentById(id) { return this.delete("comments", "deleteCommentById", id); }
  deleteCircleById(id) { return this.delete("circles", "deleteCircleById", id); }
  deleteReportById(id) { return this.delete("reports", "deleteReportById", id); }
  deleteMediaByExactKey(id) { return this.delete("mediaObjects", "deleteMediaByExactKey", id); }
  deleteRelationshipRowById(id) { return this.delete("relationshipRows", "deleteRelationshipRowById", id); }

  verifyArtifactAbsent(artifact) {
    this.calls.push("verifyArtifactAbsent");
    if (this.options.residueAt === artifact.artifactType || artifact.id.startsWith("wrong-")) return { absent: false };
    return { absent: !this.records.has(`${artifact.artifactType}:${artifact.id}`) };
  }
}

function assertFailure(result, label) {
  assert.equal(result.exitCode, 1, `${label} must exit nonzero`);
  assert.notEqual(result.manifest.status, "SUCCESS", `${label} must not report success`);
}

function childEnvironment(overrides = {}) {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(QA_|SUPABASE|PUBLIC_SUPABASE)/.test(key)));
  return {
    ...inherited,
    QA_SUPABASE_URL: stagingUrl,
    QA_EXPECTED_SUPABASE_REF: previewRef,
    QA_PRODUCTION_SUPABASE_REF: productionRef,
    QA_SUPABASE_SERVICE_ROLE_KEY: secretSentinel,
    NODE_OPTIONS: `${inherited.NODE_OPTIONS ?? ""} --require=${hookPath}`.trim(),
    ...overrides,
  };
}

function runCli(args, overrides = {}) {
  const result = spawnSync(process.execPath, ["scripts/qa/run-destructive-qa.mjs", ...args], {
    cwd: process.cwd(), encoding: "utf8", env: childEnvironment(overrides),
  });
  const output = `${result.stdout}${result.stderr}`;
  assert(!output.includes(secretSentinel), "CLI output must not expose a secret sentinel");
  assert(!output.includes("QA_TEST_NETWORK_BLOCKED"), "CLI attempted network I/O");
  return { ...result, output };
}

try {
  const successAdapter = new FakeAdapter();
  const success = await orchestrateDestructiveQa(successAdapter, { runId, targetClassification: "staging" });
  assert.equal(success.exitCode, 0, "success path must exit zero");
  assert.equal(success.manifest.status, "SUCCESS");
  assert.deepEqual(
    success.manifest.cleanupAttempts.map((item) => item.artifactType),
    ["reports", "relationshipRows", "comments", "mediaObjects", "posts", "circles", "roleAssignments", "profiles", "users"],
    "cleanup must use dependency-safe reverse order",
  );
  assert.equal(success.manifest.residueResults.length, 9, "every artifact must be verified");
  assert.equal(new Set(success.manifest.cleanupAttempts.map((item) => `${item.artifactType}:${item.id}`)).size, 9, "every exact ID is recorded once");
  assert(!successAdapter.calls.some((call) => /owner|prefix|marker/i.test(call)), "legacy cleanup must never run");
  assert(!JSON.stringify(serializeManifest(success.manifest)).includes("users-qa-run-v2-12345"), "serialized manifest must redact exact IDs");

  assertFailure(await orchestrateDestructiveQa(new FakeAdapter({ failAt: "createQaUser" }), { runId }), "failure before artifacts");
  const afterUser = await orchestrateDestructiveQa(new FakeAdapter({ failAt: "assignQaRole" }), { runId });
  assertFailure(afterUser, "failure after user");
  assert.equal(afterUser.manifest.cleanupAttempts.length, 2, "registered profile and user must be cleaned after partial creation");
  assertFailure(await orchestrateDestructiveQa(new FakeAdapter({ failAt: "createComment" }), { runId }), "failure after circle/post");
  assertFailure(await orchestrateDestructiveQa(new FakeAdapter({ failAt: "assertQaScenario" }), { runId }), "assertion failure");
  assertFailure(await orchestrateDestructiveQa(new FakeAdapter({ failAt: "deletePostById" }), { runId }), "cleanup failure continues");
  assertFailure(await orchestrateDestructiveQa(new FakeAdapter({ residueAt: "posts" }), { runId }), "residue verification");
  assertFailure(await orchestrateDestructiveQa(new FakeAdapter({ wrongIdAt: "createPost" }), { runId }), "wrong returned ID");
  assertFailure(await orchestrateDestructiveQa(new FakeAdapter({ failAt: "deleteUserByExactId" }), { runId }), "user deletion failure");
  assertFailure(await orchestrateDestructiveQa(new FakeAdapter({ failAt: "revokeRoleByExactUserId" }), { runId }), "role revocation failure");
  assertFailure(await orchestrateDestructiveQa(new FakeAdapter({ failAt: "deleteMediaByExactKey" }), { runId }), "media cleanup failure");
  assertFailure(await orchestrateDestructiveQa(new FakeAdapter({ failAt: "deleteRelationshipRowById" }), { runId }), "relationship cleanup failure");
  assertFailure(await orchestrateDestructiveQa(new FakeAdapter({ failAt: "deleteProfileByExactId" }), { runId }), "profile cleanup failure");
  assertFailure(await orchestrateDestructiveQa(new FakeAdapter({ failAt: "createPost" }), { runId }), "unexpected creation throw");

  const manifest = createRunManifest({ runId, targetClassification: "staging" });
  assert.throws(() => registerArtifact(manifest, "posts", { id: "", creationStep: "test" }), /QA_MANIFEST_EXACT_ID_REQUIRED/, "missing exact ID must be rejected");
  assert.throws(() => registerArtifact(manifest, "posts", { id: "bad id", creationStep: "test" }), /QA_MANIFEST_EXACT_ID_REQUIRED/, "malformed exact ID must be rejected");

  const dryRun = runCli(["--dry-run", "--confirm-run", runId]);
  assert.equal(dryRun.status, 0, `dry run failed: ${dryRun.output}`);
  assert.match(dryRun.output, /"phase": "PLAN"/);
  assert.doesNotMatch(dryRun.output, /EXECUTION|CLEANUP/);
  assert.equal(runCli(["--confirm-run", runId]).status, 0, "missing execute flag must remain PLAN only");
  assert.notEqual(runCli(["--dry-run", "--confirm-run", runId], { QA_SUPABASE_URL: null }).status, 0, "missing target must fail");
  assert.notEqual(runCli(["--dry-run", "--confirm-run", runId], { QA_EXPECTED_SUPABASE_REF: null }).status, 0, "missing expected ref must fail");
  assert.notEqual(runCli(["--dry-run", "--confirm-run", runId], { QA_PRODUCTION_SUPABASE_REF: null }).status, 0, "missing production ref must fail");
  assert.notEqual(runCli(["--dry-run", "--confirm-run", runId], { QA_EXPECTED_SUPABASE_REF: "differentref123" }).status, 0, "target mismatch must fail");
  assert.notEqual(runCli(["--dry-run", "--confirm-run", runId], { QA_SUPABASE_URL: "https://custom.example.test" }).status, 0, "custom target must fail");
  assert.notEqual(runCli(["--dry-run", "--confirm-run", runId], { QA_SUPABASE_URL: "http://localhost:54321" }).status, 0, "localhost target must fail");
  assert.notEqual(runCli(["--dry-run", "--execute-destructive-qa", "--confirm-run", runId]).status, 0, "conflicting modes must fail");
  assert.notEqual(runCli(["--dry-run", "--confirm-run", "confirm"]).status, 0, "generic run ID must fail");
  assert.notEqual(runCli(["--dry-run", "--confirm-run", runId, "--confirm-run", "qa-run-v2-67890"]).status, 0, "duplicate run ID flags must fail");
  assert.notEqual(runCli(["--dry-run", "--confirm-run", runId], { QA_SUPABASE_URL: productionUrl, QA_EXPECTED_SUPABASE_REF: productionRef }).status, 0, "production remains denied without v1 opt-in");
  const confirmedProductionPlan = runCli(["--dry-run", "--confirm-run", runId], { QA_SUPABASE_URL: productionUrl, QA_EXPECTED_SUPABASE_REF: productionRef, QA_ALLOW_PRODUCTION_WRITES: "1" });
  assert.equal(confirmedProductionPlan.status, 0, "fully confirmed fake production dry run may only plan");
  assert.notEqual(runCli(["--execute-destructive-qa", "--confirm-run", runId], { QA_SUPABASE_URL: productionUrl, QA_EXPECTED_SUPABASE_REF: productionRef, QA_ALLOW_PRODUCTION_WRITES: "1" }).status, 0, "execute mode without real adapter must fail");

  console.log("DESTRUCTIVE_QA_ORCHESTRATOR_OK no network requests or mutations performed");
} finally {
  rmSync(hookDirectory, { recursive: true, force: true });
}
