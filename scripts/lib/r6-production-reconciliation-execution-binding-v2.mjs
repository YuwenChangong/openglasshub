import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { loadCanonicalLauncherTemplateAuthority } from "./r6-canonical-launcher-template-authority.mjs";
import { validateLauncherBindingV2 } from "./r6-production-reconciliation-authorization-v3.mjs";
import { loadCandidateAuthority } from "./r6-production-reconciliation-candidate-authority.mjs";
import { loadProductionReconciliationV4Package } from "./r6-production-reconciliation-package-v4.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = code => { throw Object.assign(new Error(code), { code }); };

const readJson = async (artifactPath, missingCode, invalidCode) => {
  const bytes = await readFile(artifactPath).catch(() => fail(missingCode));
  try { return Object.freeze({ path: artifactPath, bytes, sha256: hash(bytes), value: JSON.parse(bytes.toString("utf8")) }); }
  catch { fail(invalidCode); }
};

async function loadUpstream({ repositoryRoot, packageRoot, candidateRoot }) {
  const [authority, loaded, canonicalLauncher] = await Promise.all([
    loadCandidateAuthority({ candidateRoot }),
    loadProductionReconciliationV4Package({ packageRoot, repositoryRoot }),
    loadCanonicalLauncherTemplateAuthority({ repositoryRoot }),
  ]);
  const { candidate } = authority;
  const pkg = loaded.executionPackage;
  const packageBytes = await readFile(path.join(packageRoot, "production-reconciliation-execution-package.json"));
  if (pkg.sourceCommit !== candidate.transportImplementationCommit
    || pkg.packageId !== candidate.packageId
    || hash(packageBytes) !== candidate.executionPackageSha256
    || pkg.manifestSha256 !== candidate.packageManifestSha256
    || loaded.manifest.packageId !== candidate.packageId
    || pkg.targetIdentitySchemaVersion !== candidate.targetIdentitySchemaVersion
    || pkg.targetIdentityCanonicalSha256 !== candidate.targetIdentityCanonicalSha256
    || pkg.runtimeRoutingSchemaVersion !== candidate.runtimeRoutingSchemaVersion
    || pkg.runtimeRoutingArtifactSha256 !== candidate.runtimeRoutingArtifactSha256
    || pkg.expectedProjectRef !== candidate.expectedProjectRef
    || loaded.manifest.launcherSha256 !== candidate.transportLauncherSha256) fail("R6_PRODUCTION_RECONCILIATION_EXECUTION_BINDING_V2_UPSTREAM_BINDING_FAILED");
  return Object.freeze({ authority, loaded, canonicalLauncher });
}

function buildBinding({ authority, loaded }) {
  const { candidate } = authority;
  return validateLauncherBindingV2({
    schemaVersion: "r6-production-reconciliation-launcher-binding-v2",
    packageSchemaVersion: candidate.packageSchemaVersion,
    targetIdentitySchemaVersion: candidate.targetIdentitySchemaVersion,
    targetIdentityCanonicalSha256: candidate.targetIdentityCanonicalSha256,
    runtimeRoutingSchemaVersion: candidate.runtimeRoutingSchemaVersion,
    runtimeRoutingArtifactSha256: candidate.runtimeRoutingArtifactSha256,
    expectedProjectRef: candidate.expectedProjectRef,
    // This remains the historical package launcher hash, not current template authority.
    launcherSha256: loaded.manifest.launcherSha256,
    secureWrapperSha256: loaded.manifest.secureWrapperSha256,
  });
}

export async function loadExecutionBindingV2({ executionBindingPath, repositoryRoot, packageRoot, candidateRoot }) {
  const [artifact, upstream] = await Promise.all([
    readJson(executionBindingPath, "R6_PRODUCTION_RECONCILIATION_EXECUTION_BINDING_MISSING", "R6_PRODUCTION_RECONCILIATION_EXECUTION_BINDING_INVALID"),
    loadUpstream({ repositoryRoot, packageRoot, candidateRoot }),
  ]);
  const value = validateLauncherBindingV2(artifact.value);
  const expected = buildBinding(upstream);
  if (JSON.stringify(value) !== JSON.stringify(expected)) fail("R6_PRODUCTION_RECONCILIATION_EXECUTION_BINDING_V2_BINDING_FAILED");
  return Object.freeze({ ...artifact, value, canonicalLauncher: upstream.canonicalLauncher });
}

export async function issueExecutionBindingV2({ outputPath, repositoryRoot, packageRoot, candidateRoot }) {
  const upstream = await loadUpstream({ repositoryRoot, packageRoot, candidateRoot });
  const value = buildBinding(upstream);
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  await mkdir(path.dirname(outputPath), { recursive: true });
  let handle;
  try {
    handle = await open(outputPath, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    if (error?.code === "EEXIST") fail("R6_PRODUCTION_RECONCILIATION_EXECUTION_BINDING_V2_REPLAY");
    throw error;
  } finally { await handle?.close(); }
  const reloaded = await loadExecutionBindingV2({ executionBindingPath: outputPath, repositoryRoot, packageRoot, candidateRoot });
  if (reloaded.sha256 !== hash(bytes) || !reloaded.bytes.equals(bytes)) fail("R6_PRODUCTION_RECONCILIATION_EXECUTION_BINDING_V2_RELOAD_FAILED");
  return reloaded;
}
