import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateSecurityHeadersArtifact } from "./lib/security-headers-artifact.mjs";

const root = await mkdtemp(path.join(tmpdir(), "openglass-p8-headers-"));
const headers = [
  "/*",
  "  X-Content-Type-Options: nosniff",
  "  X-Frame-Options: DENY",
  "  Referrer-Policy: strict-origin-when-cross-origin",
  "  Permissions-Policy: camera=(), microphone=(), geolocation=()",
].join("\n");

await mkdir(path.join(root, "dist", "client"), { recursive: true });
await writeFile(path.join(root, "dist", "client", "_headers"), headers);
assert.equal(validateSecurityHeadersArtifact(root).relativePath, path.join("dist", "client", "_headers"));

await mkdir(path.join(root, "stale", "dist"), { recursive: true });
await writeFile(path.join(root, "stale", "dist", "_headers"), headers);
assert.throws(() => validateSecurityHeadersArtifact(path.join(root, "stale")), /SECURITY_HEADERS_MISSING/);

await writeFile(path.join(root, "dist", "client", "_headers"), "/*\n  X-Content-Type-Options: nosniff\n");
assert.throws(() => validateSecurityHeadersArtifact(root), /SECURITY_HEADER_MISSING/);

await writeFile(path.join(root, "dist", "client", "_headers"), `${headers}\n  token: secret-value\n`);
assert.throws(() => validateSecurityHeadersArtifact(root), /SECURITY_HEADERS_SECRET_LIKE_VALUE/);

console.log("SECURITY_HEADERS_ARTIFACT_OK");
