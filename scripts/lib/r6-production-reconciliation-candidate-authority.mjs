import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateAuthorizationV4 } from "./r6-production-reconciliation-authorization-v3.mjs";

export const CANDIDATE_AUTHORITY_V1_VERSION = "r6-production-reconciliation-candidate-authority-v1";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = code => { throw Object.assign(new Error(code), { code }); };
const read = async (root, name) => { const artifactPath = path.join(root, name); const bytes = await readFile(artifactPath).catch(() => fail("R6_PRODUCTION_RECONCILIATION_CANDIDATE_AUTHORITY_ARTIFACT_MISSING")); try { return { path: artifactPath, bytes, value: JSON.parse(bytes), sha256: hash(bytes) }; } catch { fail("R6_PRODUCTION_RECONCILIATION_CANDIDATE_AUTHORITY_ARTIFACT_INVALID"); } };

export async function loadCandidateAuthority({ candidateRoot }) {
  const [candidateArtifact, terminalArtifact, inventoryArtifact] = await Promise.all([read(candidateRoot, "production-reconciliation-candidate.json"), read(candidateRoot, "production-reconciliation-candidate-terminal.json"), read(candidateRoot, "production-reconciliation-candidate-inventory.json")]);
  const candidate = validateAuthorizationV4(candidateArtifact.value);
  const terminal = terminalArtifact.value;
  const inventory = inventoryArtifact.value;
  const expected = { sourceCommit: candidate.transportImplementationCommit, packageId: candidate.packageId, manifestSha256: candidate.packageManifestSha256, candidateId: candidate.authorizationId, candidateSchemaVersion: candidate.schemaVersion, candidateSha256: candidateArtifact.sha256, targetIdentitySchemaVersion: candidate.targetIdentitySchemaVersion, targetIdentityCanonicalSha256: candidate.targetIdentityCanonicalSha256, runtimeRoutingSchemaVersion: candidate.runtimeRoutingSchemaVersion, runtimeRoutingArtifactSha256: candidate.runtimeRoutingArtifactSha256, expectedProjectRef: candidate.expectedProjectRef, launcherBindingSchemaVersion: "r6-production-reconciliation-launcher-binding-v2" };
  if (terminal?.schemaVersion !== "r6-production-reconciliation-candidate-terminal-v3" || Object.entries(expected).some(([key, value]) => terminal[key] !== value) || terminal.candidateIssued !== true || terminal.humanConfirmed !== false || terminal.globalClaimCreated !== false || terminal.finalConfirmationIssued !== false || terminal.executionAuthorized !== false) fail("R6_PRODUCTION_RECONCILIATION_CANDIDATE_AUTHORITY_TERMINAL_BINDING_INVALID");
  if (inventory?.schemaVersion !== "r6-production-reconciliation-candidate-inventory-v1" || !Array.isArray(inventory.artifacts)) fail("R6_PRODUCTION_RECONCILIATION_CANDIDATE_AUTHORITY_INVENTORY_INVALID");
  const inventoryEntries = new Map(inventory.artifacts.map(entry => [entry.path, entry.sha256]));
  if (inventoryEntries.get("production-reconciliation-candidate.json") !== candidateArtifact.sha256 || inventoryEntries.get("production-reconciliation-candidate-terminal.json") !== terminalArtifact.sha256) fail("R6_PRODUCTION_RECONCILIATION_CANDIDATE_AUTHORITY_INVENTORY_BINDING_INVALID");
  return Object.freeze({ schemaVersion: CANDIDATE_AUTHORITY_V1_VERSION, candidate, candidateArtifact, terminalArtifact, inventoryArtifact });
}
