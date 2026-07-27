import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_SUCCESS,
  createCurrentCanonicalProductionV3TerminalResult,
} from "./qa/run-cloudflare-pages-current-canonical-production-v3-preparation.mjs";

function required(values, name) {
  const value = values.get(name);
  if (!value) throw new Error("R6_CURRENT_CANONICAL_V3_WRAPPER_FIXTURE_INPUT_INVALID");
  return value;
}

const values = new Map();
for (let index = 0; index < process.argv.length - 2; index += 2) values.set(process.argv[index + 2], process.argv[index + 3]);
const root = path.resolve(required(values, "--root"));
const toolingCommit = required(values, "--tooling-commit");
const kind = required(values, "--kind");
const optional = (name) => values.get(name) ?? null;
const terminalPath = path.join(root, "current-canonical-production-v3-metadata-preparation-terminal-result.json");
const attestationRoot = path.resolve(optional("--attestation-root") ?? path.join(root, "attestations"));
const attestationPath = path.join(attestationRoot, "production-deployment-attestation.json");
const freshness = () => ({ attestationIssuedAt: "2099-01-01T00:00:00.000Z", attestationExpiresAt: "2099-01-01T00:15:00.000Z", freshnessValidatedAt: "2099-01-01T00:02:00.000Z", remainingValidityMilliseconds: 13 * 60 * 1000, minimumValidityMilliseconds: 13 * 60 * 1000, freshnessCheckPassed: true });
const sha = (value) => createHash("sha256").update(value).digest("hex");
const redigest = (value) => ({ ...value, resultSha256: sha(JSON.stringify({ ...value, resultSha256: null })) });

await mkdir(attestationRoot, { recursive: true });
await writeFile(attestationPath, "{}\n");
const success = () => createCurrentCanonicalProductionV3TerminalResult({
  resultPath: terminalPath,
  toolingCommit,
  outerClassification: R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_SUCCESS,
  childExitCode: 0,
  promptReached: true,
  requestSentinelReached: true,
  transportReached: true,
  attestationCreated: true,
  attestationPath,
  attestationSha256: "a".repeat(64),
  validateOnlyCompleted: true,
  ...freshness(),
  commands: ["& 'C:\\safe\\wrapper.ps1' -AuthCheckOnly", "& 'C:\\safe\\wrapper.ps1' -DryRunOnly -RunId 'qa-canary-11111111-1111-4111-8111-111111111111'"],
});
const target = () => createCurrentCanonicalProductionV3TerminalResult({
  resultPath: terminalPath,
  toolingCommit,
  outerClassification: "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TARGET_MISMATCH",
  innerClassification: "PAGES_PROJECT_V3_TARGET_MISMATCH:result.canonical_deployment.url:canonical-deployment-url-v2-observed-current:URL_HOSTNAME_MISMATCH:observed=" + "b".repeat(64),
  childExitCode: 1,
  requestSentinelReached: true,
  transportReached: true,
});
const source = () => createCurrentCanonicalProductionV3TerminalResult({
  resultPath: terminalPath,
  toolingCommit,
  outerClassification: "R6_CURRENT_CANONICAL_PRODUCTION_SOURCE_COMMIT_MISMATCH",
  innerClassification: "R6_CURRENT_CANONICAL_PRODUCTION_SOURCE_COMMIT_MISMATCH:result.canonical_deployment.deployment_trigger.metadata.commit_hash",
  childExitCode: 1,
  requestSentinelReached: true,
  transportReached: true,
});
const authcheckSuccess = async (fixedClock = false) => {
  const wrapperPath = required(values, "--wrapper-path");
  const authRoot = required(values, "--auth-root");
  const wrapperSha256 = required(values, "--wrapper-sha256");
  const now = fixedClock ? new Date("2099-01-01T00:00:00.000Z") : new Date();
  const observedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  const attestation = {
    schemaVersion: "r6-production-deployment-attestation-v1", evidenceType: "CLOUDFLARE_PAGES_PROJECT_GET_V3", provider: "cloudflare-pages", classification: "PRODUCTION_DEPLOYMENT_IDENTITY_EXACT",
    projectName: "openglasshub", projectId: "test-project-id", projectSubdomain: "openglasshub.pages.dev", productionBranch: "main", deploymentId: "test-deployment-id", canonicalDeploymentProjectId: "test-project-id", canonicalDeploymentProjectName: "openglasshub",
    environment: "production", canonicalBaseUrl: "https://openglasshub.pages.dev", immutableDeploymentUrl: "https://test.openglasshub.pages.dev/", immutableDeploymentUrlNormalizationVersion: "canonical-deployment-url-v2-observed-current", aliasesObservedType: "null", canonicalTargetProofMode: "PROJECT_SUBDOMAIN_PRODUCTION_BINDING_V1",
    triggerBranch: "main", sourceCommit: "b9ec4a06fb4aa67d7963c5d53ccc91e5c3965ed6", isSkipped: false, latestStageName: "deploy", latestStageStatus: "success", queryOrProviderEvidenceSha256: "c".repeat(64), sanitizedMetadataSha256: "d".repeat(64), projectSourceContractSha256s: ["7d3a3650c5c6c47296164335aa41f4020ca5d34e148f9045fe62ef86d6ba81a0", "10d35dd1fa3d42e48a0abf9b585d93673941f5336fa18f66bec09d2d222c0793", "2ab54ab5f18040ec80caeaa2dea7cd202f3f696ac4b589fc4874282a74590d63", "d663755d742e7f75c22a6aa77ddda4fb9401ae23815b7d50a23d0f80be4b771d", "89beea55ff2cee9ffeac79703ee56558761dbbbe34dc68d52a2a7e563519b27e"],
    targetIdentityHash: "56ab40042e30af8ce68625abb05b8dcb3c248c39ea4b116844c2d868f5421a8f", toolingCommit, wrapperSha256, wrapperVersion: "r6-consumed-run-wrapper-v1", transportSha256: "e".repeat(64), parserSelectorSha256: "f".repeat(64), endpointSha256: "a".repeat(64), accountIdSha256: "b".repeat(64), observedAt, expiresAt,
  };
  const attestationRaw = `${JSON.stringify(attestation, null, 2)}\n`;
  await writeFile(attestationPath, attestationRaw);
  const attestationSha256 = sha(attestationRaw);
  const commands = [
    `& '${wrapperPath}' -ExecutionWorktree 'C:\\test\\detached' -DeploymentAttestationPath '${attestationPath}' -DeploymentAttestationSha256 ${attestationSha256} -AuthCheckOnly -EvidenceRoot '${authRoot}'`,
    `& '${wrapperPath}' -ExecutionWorktree 'C:\\test\\detached' -DeploymentAttestationPath '${attestationPath}' -DeploymentAttestationSha256 ${attestationSha256} -DryRunOnly -EvidenceRoot '${path.join(path.dirname(authRoot), "dry-run")}'`,
  ];
  return createCurrentCanonicalProductionV3TerminalResult({ resultPath: terminalPath, toolingCommit, outerClassification: R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_SUCCESS, childExitCode: 0, promptReached: true, requestSentinelReached: true, transportReached: true, attestationCreated: true, attestationPath, attestationSha256, validateOnlyCompleted: true, ...{ attestationIssuedAt: observedAt, attestationExpiresAt: expiresAt, freshnessValidatedAt: observedAt, remainingValidityMilliseconds: 15 * 60 * 1000, minimumValidityMilliseconds: 13 * 60 * 1000, freshnessCheckPassed: true }, commands });
};
const fixture = {
  success,
  target,
  source,
  "success-zero-commands": () => redigest({ ...success(), commandsEmittedCount: 0, commands: [] }),
  "failure-two-commands": () => redigest({ ...target(), commandsEmittedCount: 2, commands: success().commands }),
  "wrong-order": () => redigest({ ...success(), commands: [...success().commands].reverse() }),
  "third-command": () => redigest({ ...success(), commandsEmittedCount: 3, commands: [...success().commands, "& 'C:\\safe\\wrapper.ps1' -ValidateOnly"] }),
  "transport-without-sentinel": () => redigest({ ...target(), requestSentinelReached: false }),
  "validate-without-attestation": () => redigest({ ...target(), validateOnlyCompleted: true }),
  "expired-success": () => redigest({ ...success(), attestationIssuedAt: "2026-07-23T21:17:50.205Z", attestationExpiresAt: "2026-07-23T21:32:50.205Z", freshnessValidatedAt: "2026-07-23T21:19:50.205Z", remainingValidityMilliseconds: 13 * 60 * 1000 }),
  secret: () => redigest({ ...target(), innerClassification: "access_token=forbidden" }),
};
if (kind === "authcheck-success") fixture[kind] = authcheckSuccess;
if (kind === "authcheck-orchestration-success") fixture[kind] = () => authcheckSuccess(true);
if (!Object.hasOwn(fixture, kind)) throw new Error("R6_CURRENT_CANONICAL_V3_WRAPPER_FIXTURE_INPUT_INVALID");
const result = await fixture[kind]();
await writeFile(terminalPath, `${JSON.stringify(result)}\n`);
process.stdout.write(`${JSON.stringify({ terminalPath, attestationRoot, attestationPath })}\n`);
