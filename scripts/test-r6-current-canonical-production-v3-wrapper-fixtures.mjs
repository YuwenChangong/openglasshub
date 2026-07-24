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
const terminalPath = path.join(root, "current-canonical-production-v3-metadata-preparation-terminal-result.json");
const attestationRoot = path.join(root, "attestations");
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
if (!Object.hasOwn(fixture, kind)) throw new Error("R6_CURRENT_CANONICAL_V3_WRAPPER_FIXTURE_INPUT_INVALID");
const result = fixture[kind]();
await writeFile(terminalPath, `${JSON.stringify(result)}\n`);
process.stdout.write(`${JSON.stringify({ terminalPath, attestationRoot })}\n`);
