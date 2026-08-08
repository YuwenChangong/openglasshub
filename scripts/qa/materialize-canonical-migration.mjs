import { assertCanonicalBlobSha256, materializeCanonicalGitBlob, resolveCanonicalGitBlob } from "../lib/canonical-git-blob.mjs";

const values = new Map();
for (let index = 2; index < process.argv.length; index += 2) values.set(process.argv[index], process.argv[index + 1]);
const worktree = values.get("--worktree");
const commit = values.get("--commit");
const relativePath = values.get("--path");
const expectedSha256 = values.get("--expected-sha256");
const destination = values.get("--destination");
if (!worktree || !commit || !relativePath || !expectedSha256 || !destination || values.size !== 5) throw new Error("R6_CANONICAL_MIGRATION_MATERIALIZE_INPUT_INVALID");
const canonical = resolveCanonicalGitBlob({ repositoryRoot: worktree, implementationCommit: commit, repositoryRelativePath: relativePath });
assertCanonicalBlobSha256(canonical, expectedSha256);
const artifact = await materializeCanonicalGitBlob({ canonicalBlob: canonical, destinationPath: destination });
process.stdout.write(`${JSON.stringify({ classification: "R6_CANONICAL_MIGRATION_ARTIFACT_MATERIALIZED", implementationCommit: commit, repositoryRelativePath: relativePath, canonicalBlobSha256: canonical.sha256, canonicalBlobBytes: canonical.byteCount, executionArtifactSha256: artifact.sha256, executionArtifactBytes: artifact.byteCount, path: artifact.path })}\n`);
