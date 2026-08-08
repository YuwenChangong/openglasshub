import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const COMMIT = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const OBJECT = /^[a-f0-9]{40}$/;

function fail(code) { throw Object.assign(new Error(code), { code }); }
function git(repositoryRoot, args, options = {}) {
  return execFileSync("git", ["-C", repositoryRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}
function assertRelativePath(repositoryRelativePath) {
  if (typeof repositoryRelativePath !== "string" || !repositoryRelativePath || repositoryRelativePath.includes("\\") || repositoryRelativePath.startsWith("/") || repositoryRelativePath.split("/").includes("..")) {
    fail("R6_CANONICAL_GIT_BLOB_PATH_INVALID");
  }
  return repositoryRelativePath;
}

export const sha256Bytes = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function resolveCanonicalGitBlob({ repositoryRoot, implementationCommit, repositoryRelativePath }) {
  if (!COMMIT.test(String(implementationCommit ?? ""))) fail("R6_CANONICAL_GIT_BLOB_COMMIT_INVALID");
  const relativePath = assertRelativePath(repositoryRelativePath);
  let objectId;
  try { objectId = git(repositoryRoot, ["rev-parse", `${implementationCommit}:${relativePath}`]); } catch { fail("R6_CANONICAL_GIT_BLOB_NOT_FOUND"); }
  if (!OBJECT.test(objectId)) fail("R6_CANONICAL_GIT_BLOB_OBJECT_INVALID");
  let bytes;
  try { bytes = execFileSync("git", ["-C", repositoryRoot, "cat-file", "blob", objectId]); } catch { fail("R6_CANONICAL_GIT_BLOB_READ_FAILED"); }
  return Object.freeze({ implementationCommit, repositoryRelativePath: relativePath, objectId, bytes, sha256: sha256Bytes(bytes), byteCount: bytes.length });
}

export function verifyCheckoutProjectionBytes({ workingBytes, canonicalBytes }) {
  const projected = [];
  let crlfCount = 0;
  for (let index = 0; index < workingBytes.length; index += 1) {
    if (workingBytes[index] !== 0x0d) { projected.push(workingBytes[index]); continue; }
    if (workingBytes[index + 1] !== 0x0a) fail("R6_MIGRATION_WORKTREE_BARE_CR_REJECTED");
    projected.push(0x0a);
    crlfCount += 1;
    index += 1;
  }
  const normalized = Buffer.from(projected);
  if (!normalized.equals(canonicalBytes)) fail("R6_MIGRATION_WORKTREE_CONTENT_DIVERGES_FROM_CANONICAL_BLOB");
  return Object.freeze({ crlfCount, checkoutProjectionClassification: crlfCount === 0 ? "IDENTICAL_TO_CANONICAL" : "CRLF_EQUIVALENT_TO_CANONICAL_LF" });
}

export async function verifyCheckoutProjectionAgainstCanonicalBlob({ repositoryRoot, implementationCommit, repositoryRelativePath, canonicalBlob = null }) {
  const blob = canonicalBlob ?? resolveCanonicalGitBlob({ repositoryRoot, implementationCommit, repositoryRelativePath });
  if (blob.implementationCommit !== implementationCommit || blob.repositoryRelativePath !== repositoryRelativePath) fail("R6_CANONICAL_GIT_BLOB_BINDING_INVALID");
  const head = git(repositoryRoot, ["rev-parse", "HEAD"]);
  if (head !== implementationCommit) fail("R6_MIGRATION_WORKTREE_COMMIT_MISMATCH");
  const status = git(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all", "--", repositoryRelativePath]);
  if (status) fail("R6_MIGRATION_WORKTREE_PATH_DIRTY");
  const diff = git(repositoryRoot, ["diff", "--numstat", implementationCommit, "--", repositoryRelativePath]);
  if (diff) fail("R6_MIGRATION_WORKTREE_CONTENT_DIVERGES_FROM_CANONICAL_BLOB");
  const workingPath = path.join(repositoryRoot, ...repositoryRelativePath.split("/"));
  let workingBytes;
  try { workingBytes = await readFile(workingPath); } catch { fail("R6_MIGRATION_WORKTREE_PATH_MISSING"); }
  const projection = verifyCheckoutProjectionBytes({ workingBytes, canonicalBytes: blob.bytes });
  return Object.freeze({
    canonicalBlobSha256: blob.sha256,
    canonicalBlobBytes: blob.byteCount,
    canonicalGitBlobObject: blob.objectId,
    workingTreeSha256: sha256Bytes(workingBytes),
    workingTreeBytes: workingBytes.length,
    workingTreeCrLfCount: projection.crlfCount,
    checkoutProjectionClassification: projection.checkoutProjectionClassification,
  });
}

export function assertCanonicalBlobSha256(canonicalBlob, expectedSha256) {
  if (!HASH.test(String(expectedSha256 ?? "")) || canonicalBlob.sha256 !== expectedSha256) fail("R6_CANONICAL_MIGRATION_BLOB_SHA256_MISMATCH");
}

export async function materializeCanonicalGitBlob({ canonicalBlob, destinationPath }) {
  const destination = path.resolve(destinationPath);
  try { await access(destination); fail("R6_CANONICAL_MIGRATION_ARTIFACT_ALREADY_EXISTS"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, canonicalBlob.bytes, { flag: "wx" });
  await rename(temporary, destination);
  const materialized = await readFile(destination);
  if (!materialized.equals(canonicalBlob.bytes)) fail("R6_CANONICAL_MIGRATION_ARTIFACT_BYTE_MISMATCH");
  return Object.freeze({ path: destination, sha256: sha256Bytes(materialized), byteCount: materialized.length });
}
