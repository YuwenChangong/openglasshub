import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { buildAuthorizationV4FromPackage, validateAuthorizationV4 } from "./r6-production-reconciliation-authorization-v3.mjs";

export const CANDIDATE_TERMINAL_V3_VERSION = "r6-production-reconciliation-candidate-terminal-v3";
export const CANDIDATE_INVENTORY_V1_VERSION = "r6-production-reconciliation-candidate-inventory-v1";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = code => { throw Object.assign(new Error(code), { code }); };
const write = async (file, value) => { const handle = await open(file, "wx", 0o600); try { const bytes = Buffer.from(`${JSON.stringify(value)}\n`); await handle.writeFile(bytes); await handle.sync(); return { path: file, sha256: hash(bytes) }; } finally { await handle.close(); } };

export async function issueAttestedCandidateV3({ candidateRoot, packageRoot, repositoryRoot, transportImplementationCommit, transportLauncherSha256, transportSha256, requiredConfirmationPhrase, now = new Date().toISOString() }) {
  await mkdir(candidateRoot, { recursive: false }).catch(error => { if (error?.code === "EEXIST") fail("R6_PRODUCTION_RECONCILIATION_CANDIDATE_ROOT_REPLAY"); throw error; });
  const candidate = await buildAuthorizationV4FromPackage({ packageRoot, repositoryRoot, transportImplementationCommit, transportLauncherSha256, transportSha256, requiredConfirmationPhrase });
  const candidateArtifact = await write(path.join(candidateRoot, "production-reconciliation-candidate.json"), candidate);
  validateAuthorizationV4(JSON.parse(await readFile(candidateArtifact.path, "utf8")));
  const terminal = { schemaVersion: CANDIDATE_TERMINAL_V3_VERSION, sourceCommit: candidate.transportImplementationCommit, packageId: candidate.packageId, packageSchemaVersion: candidate.packageSchemaVersion, executionPackageSha256: candidate.executionPackageSha256, manifestSha256: candidate.packageManifestSha256, candidateId: candidate.authorizationId, candidateSchemaVersion: candidate.schemaVersion, candidateSha256: candidateArtifact.sha256, targetIdentitySchemaVersion: candidate.targetIdentitySchemaVersion, targetIdentityCanonicalSha256: candidate.targetIdentityCanonicalSha256, runtimeRoutingSchemaVersion: candidate.runtimeRoutingSchemaVersion, runtimeRoutingArtifactSha256: candidate.runtimeRoutingArtifactSha256, expectedProjectRef: candidate.expectedProjectRef, launcherBindingSchemaVersion: "r6-production-reconciliation-launcher-binding-v2", candidateIssued: true, confirmationPhraseIssued: true, humanConfirmed: false, globalClaimCreated: false, finalConfirmationIssued: false, executionAuthorized: false, issuedAtUtc: now, classification: "R6_PRODUCTION_RECONCILIATION_CANDIDATE_V3_READY_FOR_HUMAN_CONFIRMATION" };
  const terminalArtifact = await write(path.join(candidateRoot, "production-reconciliation-candidate-terminal.json"), terminal);
  const inventory = { schemaVersion: CANDIDATE_INVENTORY_V1_VERSION, artifacts: [{ path: path.basename(candidateArtifact.path), sha256: candidateArtifact.sha256 }, { path: path.basename(terminalArtifact.path), sha256: terminalArtifact.sha256 }] };
  const inventoryArtifact = await write(path.join(candidateRoot, "production-reconciliation-candidate-inventory.json"), inventory);
  return Object.freeze({ candidate, candidateArtifact, terminalArtifact, inventoryArtifact });
}
