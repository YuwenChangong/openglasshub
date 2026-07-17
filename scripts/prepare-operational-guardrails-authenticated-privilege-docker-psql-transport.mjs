import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { buildDockerPsqlManifest, inspectPinnedPsqlImage, verifyReadOnlyMountedPacket } from "./lib/docker-psql-file-transport.mjs";
import { loadReviewedSupplementalSql } from "./lib/reviewed-sql-transport.mjs";

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};

assert(args.includes("--dry-run"), "this helper only supports --dry-run; it never executes SQL");
const targetIdentityFingerprint = valueAfter("--target-identity-fingerprint");
const expectedTargetIdentityFingerprint = valueAfter("--expected-target-identity-fingerprint");
const connectionMode = valueAfter("--connection-mode");
const manifestPath = valueAfter("--manifest");
assert(targetIdentityFingerprint, "--target-identity-fingerprint is required");
assert(expectedTargetIdentityFingerprint, "--expected-target-identity-fingerprint is required");
assert(connectionMode, "--connection-mode is required");
assert(manifestPath, "--manifest is required");

const root = process.cwd();
const packet = await loadReviewedSupplementalSql({ root });
const image = inspectPinnedPsqlImage();
const mount = verifyReadOnlyMountedPacket({ root, packet });
const repositoryCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const manifest = buildDockerPsqlManifest({ packet, image, mount, repositoryCommit, targetIdentityFingerprint, expectedTargetIdentityFingerprint, connectionMode });
const resolvedManifestPath = path.resolve(root, manifestPath);
await writeFile(resolvedManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({ dryRunValidation: manifest.dryRunValidation, sourceSha256: manifest.hostSha256, containerSha256: manifest.containerSha256, hostByteCount: manifest.hostByteCount, containerByteCount: manifest.containerByteCount, pinnedDockerDigest: manifest.pinnedDockerDigest, connectionMode: manifest.connectionMode, mountedReadOnly: manifest.mountedReadOnly }));
