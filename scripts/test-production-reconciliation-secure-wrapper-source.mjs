import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CANONICAL_SECURE_WRAPPER_SOURCE_RELATIVE_PATH, loadCanonicalSecureWrapperSourceAuthority } from "./lib/r6-canonical-secure-wrapper-source-authority.mjs";

const root = process.cwd();
const authority = await loadCanonicalSecureWrapperSourceAuthority({ repositoryRoot: root });
const bytes = await readFile(authority.canonicalSecureWrapperSourcePath);
assert.equal(authority.canonicalSecureWrapperSourceSha256, createHash("sha256").update(bytes).digest("hex"));
assert.equal(bytes.includes(0x0d), false, "canonical secure-wrapper template must remain LF-only in the checkout");
assert.deepEqual(
  bytes,
  execFileSync("git", ["show", `HEAD:${CANONICAL_SECURE_WRAPPER_SOURCE_RELATIVE_PATH}`]),
  "canonical secure-wrapper template checkout bytes must equal its committed Git blob",
);
execFileSync("powershell.exe", ["-NoProfile", "-Command", "[void][scriptblock]::Create([IO.File]::ReadAllText($env:R6_WRAPPER_SOURCE))"], { stdio: "pipe", env: { ...process.env, R6_WRAPPER_SOURCE: authority.canonicalSecureWrapperSourcePath } });
const fakeRoot = await mkdtemp(path.join(os.tmpdir(), "r6-secure-wrapper-source-"));
try {
  const fakeSource = path.join(fakeRoot, CANONICAL_SECURE_WRAPPER_SOURCE_RELATIVE_PATH);
  await mkdir(path.dirname(fakeSource), { recursive: true });
  await writeFile(fakeSource, Buffer.concat([bytes, Buffer.from("\n# tampered\n")]));
  const tampered = await loadCanonicalSecureWrapperSourceAuthority({ repositoryRoot: fakeRoot });
  assert.notEqual(tampered.canonicalSecureWrapperSourceSha256, authority.canonicalSecureWrapperSourceSha256);
  assert.equal(tampered.canonicalSecureWrapperSourcePath, fakeSource);
} finally { await rm(fakeRoot, { recursive: true, force: true }); }
assert.doesNotMatch(await readFile(authority.canonicalSecureWrapperSourcePath, "utf8"), /PGPASSWORD|start-r6-production-reconciliation-secure-session\.ps1|prepareFinalExecutionHistorical/);
console.log("R6_PRODUCTION_RECONCILIATION_CANONICAL_SECURE_WRAPPER_SOURCE_AUTHORITY_PASS");
