import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const CANONICAL_SECURE_WRAPPER_SOURCE_RELATIVE_PATH = "scripts/qa/templates/r6-production-reconciliation-secure-session-v1.ps1.template";
export const CANONICAL_DPAPI_CREDENTIAL_BROKER_SOURCE_RELATIVE_PATH = "scripts/qa/r6-production-dpapi-credential-broker.ps1";

export async function loadCanonicalSecureWrapperSourceAuthority({ repositoryRoot }) {
  const canonicalSecureWrapperSourcePath = path.join(repositoryRoot, CANONICAL_SECURE_WRAPPER_SOURCE_RELATIVE_PATH);
  const bytes = await readFile(canonicalSecureWrapperSourcePath);
  return Object.freeze({
    canonicalSecureWrapperSourcePath,
    canonicalSecureWrapperSourceSha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
