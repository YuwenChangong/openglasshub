import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_SUCCESS,
  R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TERMINAL_VERSION,
  validateCurrentCanonicalProductionV3TerminalResult,
} from "./run-cloudflare-pages-current-canonical-production-v3-preparation.mjs";

const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const SUCCESS = R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_SUCCESS;
const SAFE_FAILURES = new Set([
  "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_OAUTH_NOT_READY",
  "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_ACCOUNT_INPUT_FAILED",
  "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TARGET_MISMATCH",
  "R6_CURRENT_CANONICAL_PRODUCTION_SOURCE_COMMIT_MISMATCH",
  "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TRANSPORT_FAILED",
  "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_ATTESTATION_SCHEMA_UNSAFE",
  "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_VALIDATE_ONLY_FAILED",
  "R6_HARDENED_PREFLIGHT_ATTESTATION_VALIDITY_INSUFFICIENT",
  "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_COMMAND_PREPARATION_FAILED",
]);
const KEYS = Object.freeze([
  "schemaVersion", "toolingCommit", "outerClassification", "innerClassification", "childExitCode",
  "promptReached", "requestSentinelReached", "transportReached", "attestationCreated", "attestationPath",
  "attestationSha256", "validateOnlyCompleted", "commandsEmittedCount", "commands", "sanitizedEvidencePath",
  "sanitizedEvidenceDigest", "resultSha256",
]);

function reject(code) {
  throw Object.assign(new Error(code), { code });
}

function digest(value) {
  const copy = { ...value, resultSha256: null };
  return createHash("sha256").update(JSON.stringify(copy)).digest("hex");
}

function containsSensitiveValue(text) {
  return /(?:password|access[_-]?token|refresh[_-]?token|authorization|service[_-]?role|anon[_-]?key|apikey|postgres(?:ql)?:\/\/|eyJ[A-Za-z0-9_-]{12,}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i.test(text);
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function assertRegularFileWithin(root, candidate, code) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (!isWithin(resolvedRoot, resolvedCandidate)) reject(code);
  let entry;
  try { entry = await lstat(resolvedCandidate); } catch { reject(code); }
  if (!entry.isFile() || entry.isSymbolicLink()) reject(code);
  let realRoot, realCandidate;
  try { [realRoot, realCandidate] = await Promise.all([realpath(resolvedRoot), realpath(resolvedCandidate)]); } catch { reject(code); }
  if (!isWithin(realRoot, realCandidate)) reject(code);
  let finalStat;
  try { finalStat = await stat(realCandidate); } catch { reject(code); }
  if (!finalStat.isFile()) reject(code);
  return realCandidate;
}

function assertExactKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject("R6_CURRENT_CANONICAL_V3_TERMINAL_SCHEMA_INVALID");
  const actual = Object.keys(value).sort();
  const expected = [...KEYS].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) reject("R6_CURRENT_CANONICAL_V3_TERMINAL_SCHEMA_INVALID");
}

function assertCommands(value) {
  if (value.commands.some((command) => typeof command !== "string" || containsSensitiveValue(command))) reject("R6_CURRENT_CANONICAL_V3_TERMINAL_SECRET_REJECTED");
  if (value.commands.some((command) => /(?:ExecuteApprovedPhase|PrepareCurrentCanonicalProductionV3|\s-ExecuteApprovedPhase\b)/.test(command))) reject("R6_CURRENT_CANONICAL_V3_TERMINAL_COMMAND_UNSAFE");
  if (value.commands.length === 2 && (value.commands[0].match(/-AuthCheckOnly\b/g) ?? []).length !== 1) reject("R6_CURRENT_CANONICAL_V3_TERMINAL_COMMAND_ORDER_INVALID");
  if (value.commands.length === 2 && (value.commands[1].match(/-DryRunOnly\b/g) ?? []).length !== 1) reject("R6_CURRENT_CANONICAL_V3_TERMINAL_COMMAND_ORDER_INVALID");
}

function assertClassificationState(value) {
  if (value.schemaVersion !== R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TERMINAL_VERSION || !COMMIT.test(String(value.toolingCommit))) reject("R6_CURRENT_CANONICAL_V3_TERMINAL_SCHEMA_INVALID");
  if (!Number.isInteger(value.childExitCode) || !Number.isInteger(value.commandsEmittedCount) || value.commands.length !== value.commandsEmittedCount) reject("R6_CURRENT_CANONICAL_V3_TERMINAL_IMPOSSIBLE_STATE");
  for (const key of ["promptReached", "requestSentinelReached", "transportReached", "attestationCreated", "validateOnlyCompleted"]) if (typeof value[key] !== "boolean") reject("R6_CURRENT_CANONICAL_V3_TERMINAL_SCHEMA_INVALID");
  if (typeof value.outerClassification !== "string" || (value.innerClassification !== null && typeof value.innerClassification !== "string")) reject("R6_CURRENT_CANONICAL_V3_TERMINAL_SCHEMA_INVALID");
  if (containsSensitiveValue(JSON.stringify(value))) reject("R6_CURRENT_CANONICAL_V3_TERMINAL_SECRET_REJECTED");
  if (value.resultSha256 !== digest(value) || !SHA256.test(String(value.sanitizedEvidenceDigest))) reject("R6_CURRENT_CANONICAL_V3_TERMINAL_SCHEMA_INVALID");
  if (value.transportReached && !value.requestSentinelReached) reject("R6_CURRENT_CANONICAL_V3_TERMINAL_IMPOSSIBLE_STATE");
  if (value.attestationCreated && !value.transportReached) reject("R6_CURRENT_CANONICAL_V3_TERMINAL_IMPOSSIBLE_STATE");
  if (value.validateOnlyCompleted && !value.attestationCreated) reject("R6_CURRENT_CANONICAL_V3_TERMINAL_IMPOSSIBLE_STATE");
  const hasAttestation = typeof value.attestationPath === "string" && SHA256.test(String(value.attestationSha256));
  if (value.attestationCreated !== hasAttestation) reject("R6_CURRENT_CANONICAL_V3_TERMINAL_IMPOSSIBLE_STATE");
  if (value.outerClassification === SUCCESS) {
    if (value.childExitCode !== 0 || value.innerClassification !== null || !value.requestSentinelReached || !value.transportReached || !value.attestationCreated || !value.validateOnlyCompleted || value.commands.length !== 2) reject("R6_CURRENT_CANONICAL_V3_TERMINAL_IMPOSSIBLE_STATE");
    return "success";
  }
  if (!SAFE_FAILURES.has(value.outerClassification) || value.childExitCode === 0 || value.commands.length !== 0 || value.validateOnlyCompleted) reject("R6_CURRENT_CANONICAL_V3_TERMINAL_IMPOSSIBLE_STATE");
  if (["R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TARGET_MISMATCH", "R6_CURRENT_CANONICAL_PRODUCTION_SOURCE_COMMIT_MISMATCH", "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TRANSPORT_FAILED", "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_ATTESTATION_SCHEMA_UNSAFE"].includes(value.outerClassification) && (value.attestationCreated || value.validateOnlyCompleted)) reject("R6_CURRENT_CANONICAL_V3_TERMINAL_IMPOSSIBLE_STATE");
  if (value.outerClassification === "R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TARGET_MISMATCH" && !/^PAGES_PROJECT_V3_TARGET_MISMATCH:result\.canonical_deployment\.url:canonical-deployment-url-v2-observed-current:URL_HOSTNAME_MISMATCH:observed=[a-f0-9]{64}$/.test(String(value.innerClassification ?? ""))) reject("R6_CURRENT_CANONICAL_V3_TERMINAL_CLASSIFICATION_INVALID");
  if (value.outerClassification === "R6_CURRENT_CANONICAL_PRODUCTION_SOURCE_COMMIT_MISMATCH" && !String(value.innerClassification ?? "").startsWith("R6_CURRENT_CANONICAL_PRODUCTION_SOURCE_COMMIT_MISMATCH:")) reject("R6_CURRENT_CANONICAL_V3_TERMINAL_CLASSIFICATION_INVALID");
  return "failure";
}

export async function validateCurrentCanonicalProductionV3TerminalFile({ terminalResultPath, toolingCommit, evidenceRoot, attestationRoot }) {
  if (!COMMIT.test(String(toolingCommit)) || !terminalResultPath || !evidenceRoot || !attestationRoot) reject("R6_CURRENT_CANONICAL_V3_TERMINAL_INPUT_INVALID");
  const terminalPath = await assertRegularFileWithin(evidenceRoot, terminalResultPath, "R6_CURRENT_CANONICAL_V3_TERMINAL_PATH_REJECTED");
  if (path.basename(terminalPath) !== "current-canonical-production-v3-metadata-preparation-terminal-result.json") reject("R6_CURRENT_CANONICAL_V3_TERMINAL_PATH_REJECTED");
  let raw, value;
  try { raw = await readFile(terminalPath); value = JSON.parse(raw.toString("utf8")); } catch { reject("R6_CURRENT_CANONICAL_V3_TERMINAL_JSON_INVALID"); }
  assertExactKeys(value);
  if (path.resolve(value.sanitizedEvidencePath ?? "") !== terminalPath || value.sanitizedEvidenceDigest !== createHash("sha256").update(terminalPath).digest("hex")) reject("R6_CURRENT_CANONICAL_V3_TERMINAL_PATH_REJECTED");
  if (value.toolingCommit !== toolingCommit) reject("R6_CURRENT_CANONICAL_V3_TERMINAL_TOOLING_COMMIT_MISMATCH");
  let kind;
  try { validateCurrentCanonicalProductionV3TerminalResult(value, { resultPath: terminalPath, toolingCommit }); kind = assertClassificationState(value); } catch (error) { if (String(error?.code ?? "").startsWith("R6_CURRENT_CANONICAL_V3_")) throw error; reject("R6_CURRENT_CANONICAL_V3_TERMINAL_IMPOSSIBLE_STATE"); }
  assertCommands(value);
  if (kind === "success") await assertRegularFileWithin(attestationRoot, value.attestationPath, "R6_CURRENT_CANONICAL_V3_TERMINAL_ATTESTATION_PATH_REJECTED");
  return Object.freeze({ kind, classification: value.outerClassification, terminalSha256: createHash("sha256").update(raw).digest("hex") });
}

function parseArgs(argv) {
  if (argv.length !== 8 || argv[0] !== "--terminal-result-path" || argv[2] !== "--tooling-commit" || argv[4] !== "--evidence-root" || argv[6] !== "--attestation-root") reject("R6_CURRENT_CANONICAL_V3_TERMINAL_INPUT_INVALID");
  return { terminalResultPath: argv[1], toolingCommit: argv[3], evidenceRoot: argv[5], attestationRoot: argv[7] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await validateCurrentCanonicalProductionV3TerminalFile(parseArgs(process.argv.slice(2)));
    process.stdout.write(`R6_CURRENT_CANONICAL_V3_TERMINAL_${result.kind.toUpperCase()}\n`);
  } catch (error) {
    process.stderr.write(`${error?.code ?? "R6_CURRENT_CANONICAL_V3_TERMINAL_IMPOSSIBLE_STATE"}\n`);
    process.exitCode = 1;
  }
}
