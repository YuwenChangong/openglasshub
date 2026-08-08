import { assertCanonicalBlobSha256, resolveCanonicalGitBlob, verifyCheckoutProjectionAgainstCanonicalBlob } from "../lib/canonical-git-blob.mjs";

const values = new Map();
for (let index = 2; index < process.argv.length; index += 2) values.set(process.argv[index], process.argv[index + 1]);
const worktree = values.get("--worktree");
const commit = values.get("--commit");
const relativePath = values.get("--path");
const expectedSha256 = values.get("--expected-sha256");
if (!worktree || !commit || !relativePath || !expectedSha256 || values.size !== 4) throw new Error("R6_CANONICAL_MIGRATION_BYTE_CONTRACT_INPUT_INVALID");
const canonical = resolveCanonicalGitBlob({ repositoryRoot: worktree, implementationCommit: commit, repositoryRelativePath: relativePath });
assertCanonicalBlobSha256(canonical, expectedSha256);
const projection = await verifyCheckoutProjectionAgainstCanonicalBlob({ repositoryRoot: worktree, implementationCommit: commit, repositoryRelativePath: relativePath, canonicalBlob: canonical });
process.stdout.write(`${JSON.stringify({ classification: "R6_CANONICAL_MIGRATION_BYTE_CONTRACT_VALID", implementationCommit: commit, repositoryRelativePath: relativePath, ...projection })}\n`);
