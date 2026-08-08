import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertCanonicalBlobSha256, materializeCanonicalGitBlob, resolveCanonicalGitBlob, verifyCheckoutProjectionAgainstCanonicalBlob, verifyCheckoutProjectionBytes } from "./lib/canonical-git-blob.mjs";

const root = process.cwd();
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const migrationPath = "supabase/migrations/20260807073929_reconcile_production_schema_drift.sql";
const expectedSha256 = "f63ecb18b0b2c183c8e13f3db6526956afd2af508f02d7c89f02a912cae91cd0";
const canonical = resolveCanonicalGitBlob({ repositoryRoot: root, implementationCommit: commit, repositoryRelativePath: migrationPath });
assert.equal(canonical.sha256, expectedSha256);
assert.equal(canonical.byteCount, 22730);
assert.equal([...canonical.bytes].filter((byte) => byte === 0x0d).length, 0);
assert.equal(verifyCheckoutProjectionBytes({ workingBytes: canonical.bytes, canonicalBytes: canonical.bytes }).checkoutProjectionClassification, "IDENTICAL_TO_CANONICAL");
const crlf = Buffer.from(canonical.bytes.toString("utf8").replaceAll("\n", "\r\n"), "utf8");
assert.equal(verifyCheckoutProjectionBytes({ workingBytes: crlf, canonicalBytes: canonical.bytes }).checkoutProjectionClassification, "CRLF_EQUIVALENT_TO_CANONICAL_LF");
for (const [name, value, expectedCode] of [
  ["character", Buffer.from(`X${canonical.bytes.subarray(1).toString("utf8")}`, "utf8"), "R6_MIGRATION_WORKTREE_CONTENT_DIVERGES_FROM_CANONICAL_BLOB"],
  ["trailing-whitespace", Buffer.from(`${canonical.bytes.toString("utf8").replace(";\n", "; \n")}`, "utf8"), "R6_MIGRATION_WORKTREE_CONTENT_DIVERGES_FROM_CANONICAL_BLOB"],
  ["bom", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), canonical.bytes]), "R6_MIGRATION_WORKTREE_CONTENT_DIVERGES_FROM_CANONICAL_BLOB"],
  ["bare-cr", Buffer.concat([Buffer.from([0x0d]), canonical.bytes]), "R6_MIGRATION_WORKTREE_BARE_CR_REJECTED"],
  ["final-newline", Buffer.from(canonical.bytes.toString("utf8").replace(/\n$/, ""), "utf8"), "R6_MIGRATION_WORKTREE_CONTENT_DIVERGES_FROM_CANONICAL_BLOB"],
]) {
  assert.throws(() => verifyCheckoutProjectionBytes({ workingBytes: value, canonicalBytes: canonical.bytes }), new RegExp(expectedCode), name);
}
assert.throws(() => assertCanonicalBlobSha256(canonical, "0".repeat(64)), /R6_CANONICAL_MIGRATION_BLOB_SHA256_MISMATCH/);
assert.throws(() => resolveCanonicalGitBlob({ repositoryRoot: root, implementationCommit: "0".repeat(40), repositoryRelativePath: migrationPath }), /R6_CANONICAL_GIT_BLOB_NOT_FOUND/);
assert.throws(() => resolveCanonicalGitBlob({ repositoryRoot: root, implementationCommit: commit, repositoryRelativePath: "supabase/migrations/not-the-migration.sql" }), /R6_CANONICAL_GIT_BLOB_NOT_FOUND/);

const temp = await mkdtemp(path.join(os.tmpdir(), "r6-canonical-git-blob-"));
try {
  const artifact = await materializeCanonicalGitBlob({ canonicalBlob: canonical, destinationPath: path.join(temp, "canonical-migration.sql") });
  assert.equal(artifact.sha256, expectedSha256);
  assert.equal(artifact.byteCount, canonical.byteCount);
  assert.deepEqual(await readFile(artifact.path), canonical.bytes);
  const verifierOutput = JSON.parse(execFileSync(process.execPath, ["scripts/qa/verify-canonical-migration-byte-contract.mjs", "--worktree", root, "--commit", commit, "--path", migrationPath, "--expected-sha256", expectedSha256], { cwd: root, encoding: "utf8" }));
  assert.equal(verifierOutput.classification, "R6_CANONICAL_MIGRATION_BYTE_CONTRACT_VALID");
  const cliArtifactPath = path.join(temp, "canonical-migration-cli.sql");
  const materializerOutput = JSON.parse(execFileSync(process.execPath, ["scripts/qa/materialize-canonical-migration.mjs", "--worktree", root, "--commit", commit, "--path", migrationPath, "--expected-sha256", expectedSha256, "--destination", cliArtifactPath], { cwd: root, encoding: "utf8" }));
  assert.equal(materializerOutput.executionArtifactSha256, expectedSha256);
  assert.deepEqual(await readFile(cliArtifactPath), canonical.bytes);

  const projection = await verifyCheckoutProjectionAgainstCanonicalBlob({ repositoryRoot: root, implementationCommit: commit, repositoryRelativePath: migrationPath, canonicalBlob: canonical });
  assert.equal(projection.canonicalBlobSha256, expectedSha256);
  assert.match(projection.checkoutProjectionClassification, /^(IDENTICAL_TO_CANONICAL|CRLF_EQUIVALENT_TO_CANONICAL_LF)$/);

  const seed = path.join(temp, "seed");
  execFileSync("git", ["clone", "--no-hardlinks", "--local", root, seed], { stdio: "pipe" });
  execFileSync("git", ["-C", seed, "config", "user.email", "r6-test@example.invalid"]);
  execFileSync("git", ["-C", seed, "config", "user.name", "R6 test"]);
  await writeFile(path.join(seed, ".gitattributes"), await readFile(path.join(root, ".gitattributes")));
  execFileSync("git", ["-C", seed, "add", ".gitattributes"]);
  execFileSync("git", ["-C", seed, "commit", "-m", "test eol attribute"], { stdio: "pipe" });
  const fresh = path.join(temp, "fresh-core-autocrlf");
  execFileSync("git", ["-c", "core.autocrlf=true", "clone", "--no-hardlinks", "--local", seed, fresh], { stdio: "pipe" });
  const freshCommit = execFileSync("git", ["-C", fresh, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const cloneCanonical = resolveCanonicalGitBlob({ repositoryRoot: fresh, implementationCommit: freshCommit, repositoryRelativePath: migrationPath });
  const cloneProjection = await verifyCheckoutProjectionAgainstCanonicalBlob({ repositoryRoot: fresh, implementationCommit: freshCommit, repositoryRelativePath: migrationPath, canonicalBlob: cloneCanonical });
  assert.equal(cloneCanonical.sha256, expectedSha256);
  assert.equal(cloneProjection.checkoutProjectionClassification, "IDENTICAL_TO_CANONICAL");
  assert.equal(cloneProjection.workingTreeSha256, expectedSha256);
  assert.match(execFileSync("git", ["-C", fresh, "check-attr", "text", "eol", "--", migrationPath], { encoding: "utf8" }), /text: set[\s\S]*eol: lf/);
  console.log(JSON.stringify({ classification: "R6_CANONICAL_MIGRATION_BYTE_CONTRACT_TESTS_VALID", canonicalSha256: canonical.sha256, cases: 10, coreAutocrlfIntegration: "PASS", freshCheckout: cloneProjection.checkoutProjectionClassification, materializedArtifactSha256: artifact.sha256 }));
} finally {
  await rm(temp, { recursive: true, force: true });
}
