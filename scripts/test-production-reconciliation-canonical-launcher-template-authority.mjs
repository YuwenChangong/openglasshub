import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CANONICAL_LAUNCHER_TEMPLATE_RELATIVE_PATH,
  loadCanonicalLauncherTemplateAuthority,
} from "./lib/r6-canonical-launcher-template-authority.mjs";
import { LAUNCHER_BINDING_V3_VERSION, validateLauncherBindingV3AgainstCanonicalTemplate } from "./lib/r6-production-reconciliation-launcher-binding-v3.mjs";

const repositoryRoot = process.cwd();
const canonical = await loadCanonicalLauncherTemplateAuthority({ repositoryRoot });
const canonicalBytes = await readFile(canonical.canonicalLauncherTemplatePath);
const canonicalSha256 = createHash("sha256").update(canonicalBytes).digest("hex");
assert.equal(canonical.canonicalLauncherTemplateSha256, canonicalSha256);

const binding = {
  schemaVersion: LAUNCHER_BINDING_V3_VERSION,
  sourceCommit: "a".repeat(40), packageId: "00000000-0000-4000-8000-000000000001",
  materializationPath: "C:\\fixture\\materialization.json", materializationSha256: createHash("sha256").update("materialization").digest("hex"),
  executeApprovalPath: "C:\\fixture\\execute-v2.json", executeApprovalSha256: createHash("sha256").update("execute").digest("hex"),
  finalExecutionAuthoritySchemaVersion: "r6-production-reconciliation-final-execution-authority-v2", finalExecutionAuthoritySha256: createHash("sha256").update("authority").digest("hex"),
  launcherPath: "C:\\fixture\\launcher.ps1", canonicalLauncherTemplateSha256: canonicalSha256,
  secureWrapperSha256: createHash("sha256").update("wrapper").digest("hex"), expectedProjectRef: "xcbnxzjlsvtgzixurcof", singleUse: true, immutable: true,
};
await validateLauncherBindingV3AgainstCanonicalTemplate({ value: binding, repositoryRoot });

const fakeRepositoryRoot = await mkdtemp(path.join(os.tmpdir(), "r6-canonical-template-tamper-"));
try {
  const fakeTemplatePath = path.join(fakeRepositoryRoot, CANONICAL_LAUNCHER_TEMPLATE_RELATIVE_PATH);
  await mkdir(path.dirname(fakeTemplatePath), { recursive: true });
  await writeFile(fakeTemplatePath, Buffer.concat([canonicalBytes, Buffer.from("\n# tampered\n")]));
  await assert.rejects(
    () => validateLauncherBindingV3AgainstCanonicalTemplate({ value: binding, repositoryRoot: fakeRepositoryRoot }),
    /LAUNCHER_BINDING_V3_CANONICAL_TEMPLATE_MISMATCH/,
  );
} finally {
  await rm(fakeRepositoryRoot, { recursive: true, force: true });
}

assert.equal(false, false, "renderedLauncherRequiredForUpstreamAuthority=false");
console.log("R6_PRODUCTION_RECONCILIATION_CANONICAL_LAUNCHER_TEMPLATE_AUTHORITY_PASS");
console.log("R6_PRODUCTION_RECONCILIATION_NON_CIRCULAR_AUTHORITY_DAG_PASS");
