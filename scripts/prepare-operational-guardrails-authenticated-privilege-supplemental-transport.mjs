import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { buildExecutionManifest, loadReviewedSupplementalSql } from "./lib/reviewed-sql-transport.mjs";

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};

assert(args.includes("--dry-run"), "this helper only supports --dry-run; it never executes SQL");
const targetIdentityFingerprint = valueAfter("--target-identity-fingerprint");
const manifestPath = valueAfter("--manifest");
assert(targetIdentityFingerprint, "--target-identity-fingerprint is required");
assert(manifestPath, "--manifest is required");

const packet = await loadReviewedSupplementalSql();
const manifest = buildExecutionManifest({ packet, targetIdentityFingerprint });
const resolvedManifestPath = path.resolve(process.cwd(), manifestPath);
await writeFile(resolvedManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({ dryRunValidation: manifest.dryRunValidation, manifestPath: path.relative(process.cwd(), resolvedManifestPath), sourceSha256: manifest.sourceSha256, payloadSha256: manifest.payloadSha256, sourceByteCount: manifest.sourceByteCount, payloadByteCount: manifest.payloadByteCount, transportMethod: manifest.transportMethod }));
