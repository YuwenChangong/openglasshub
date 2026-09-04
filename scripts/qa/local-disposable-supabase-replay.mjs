import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFile, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildLocalSupabaseReplayMirror } from "../build-local-supabase-replay-mirror.mjs";
import { reviewFingerprintCandidate } from "../production-schema-fingerprint-review.mjs";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const INHERITED_DATABASE_CONNECTION_VARIABLES = ["POSTGRES_URL", "DATABASE_URL", "PGHOST", "PGPORT", "PGSERVICE"];
const REMOTE_CONNECTION_VARIABLES = ["SUPABASE_DB_URL", "SUPABASE_URL", "PUBLIC_SUPABASE_URL"];
const LINKED_PROJECT_VARIABLES = ["SUPABASE_PROJECT_REF", "SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD"];
const PORT_FIELDS = [
  ["api", "port", 1], ["db", "port", 2], ["db", "shadow_port", 0], ["studio", "port", 3],
  ["local_smtp", "port", 4], ["analytics", "port", 7], ["db.pooler", "port", 9], ["edge_runtime", "inspector_port", 83],
];
const NPX = process.platform === "win32" ? "npx.cmd" : "npx";
const FINGERPRINT_EVIDENCE_PREFIX = "openglass-local-disposable-supabase-evidence-";
const FAILURE_RECEIPT_FILENAME = "failure-receipt.json";
const START_DIAGNOSTIC_FILENAME = "start-diagnostic.json";
const FAILURE_RECEIPT_KEYS = ["format", "runId", "stage", "class", "exitCode", "code", "startDiagnostic", "cleanupStatus"];
const START_DIAGNOSTIC_KEYS = ["format", "classification", "firstFatalContext"];
const START_FAILURE_DIAGNOSTICS = new Set([
  "NOT_APPLICABLE",
  "UNKNOWN",
  "CONFIG_INVALID",
  "PORT_CONFLICT",
  "DOCKER_UNAVAILABLE",
  "SERVICE_HEALTH_FAILED",
  "VECTOR_HOST_NETWORK_UNREACHABLE",
]);
const RUNTIME_FAILURE_CLASSES = new Map([
  ["supabase-start-owned-root", "start-failed"],
  ["validate-local-status-target", "status-invalid"],
  ["validate-owned-postgres-container", "owned-container-invalid"],
  ["validate-migration-ledger", "migration-ledger-invalid"],
  ["validate-empty-migration-ledger", "migration-ledger-invalid"],
  ["cleanup-owned-root", "cleanup-failed"],
]);
const CANDIDATE_KEYS = ["format", "generatedFrom", "canonicalMigrationCount", "legalConsentPrerequisiteCount", "localMigrationLedger", "objectCount", "objects"];
const LEDGER_ENTRY_KEYS = ["version", "name", "statementCount"];
const OBJECT_ENTRY_KEYS = ["objectType", "schema", "name", "identity", "attribute", "normalizedStructuralDefinition", "deterministicSha256", "sourceMigrations", "firstIntroducedMigration", "laterModifyingMigrations", "securityRelevant", "legalConsentPrerequisite", "label"];
const REVIEW_KEYS = ["format", "classification", "expected", "candidate", "migrationLedger", "objectIdentity", "fixtureMatchesCandidate", "reviewId"];
const REVIEW_EXPECTED_SCOPE_KEYS = ["canonicalMigrationCount", "localMigrationLedgerCount", "objectCount"];
const REVIEW_CANDIDATE_SCOPE_KEYS = ["generatedFrom", "canonicalMigrationCount", "localMigrationLedgerCount", "objectCount"];
const REVIEW_LEDGER_KEYS = ["expectedCount", "candidateCount", "missingFromCandidate", "addedByCandidate", "orderMatchesForSharedEntries"];
const REVIEW_OBJECT_KEYS = ["missingFromCandidate", "addedByCandidate", "divergentDefinitions"];
const REVIEW_LEDGER_ENTRY_KEYS = ["version", "name"];
const SENSITIVE_EVIDENCE_KEY = /(?:credential|password|passphrase|passwd|secret|token|authorization|api[_-]?key|private[_-]?key|bearer)/i;
const SENSITIVE_EVIDENCE_VALUE = /(?:postgres(?:ql)?:\/\/|(?:https?:\/\/)[^\s"']*@|-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----|\b(?:bearer|basic)\s+[^\s]+|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|(?:access|refresh|id)[_-]?token\s*[=:]|\bjwt\s*[=:])/i;
const SENSITIVE_NAMED_VALUE = /\b(?:database_url|(?:supabase|cloudflare|cf)_[a-z0-9_]+|(?:access|refresh|id)[_-]?token|jwt|password|passwd|passphrase|api[_-]?key|authorization)\s*[=:]\s*(?!\[REDACTED\])[^\s,;]+/i;
const REDACTED = "[REDACTED]";
const MAX_DIAGNOSTIC_CONTEXT_LENGTH = 512;

function assertRunId(runId) {
  if (!/^[a-f0-9]{8}$/i.test(runId)) throw new Error("Disposable replay run id must be eight hexadecimal characters");
  return runId.toLowerCase();
}

function isWithin(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

export function assertOwnedDisposableRoot({ disposableRoot, repositoryRoot }) {
  const root = path.resolve(disposableRoot);
  const temp = path.resolve(os.tmpdir());
  if (!isWithin(root, temp) || isWithin(root, repositoryRoot) || root === temp) throw new Error("Disposable replay root must be an owned temporary directory outside the repository");
  return root;
}

export function assertLocalReplayTarget(target, { ownedNetworkHosts = new Set() } = {}) {
  let host;
  try { host = new URL(target).hostname.toLowerCase().replace(/^\[|\]$/g, ""); } catch { throw new Error("Refusing malformed local replay target"); }
  if (!LOCAL_HOSTS.has(host) && !ownedNetworkHosts.has(host)) throw new Error("Refusing non-local Supabase replay target");
  return true;
}

export function assertSafeLocalReplayEnvironment(environment = process.env) {
  for (const name of INHERITED_DATABASE_CONNECTION_VARIABLES) {
    if (environment[name]) throw new Error(`Refusing inherited database connection variable ${name}`);
  }
  for (const name of REMOTE_CONNECTION_VARIABLES) {
    const value = environment[name];
    if (!value) continue;
    try { assertLocalReplayTarget(value); } catch { throw new Error(`Refusing remote connection variable ${name}`); }
  }
  for (const [name, value] of Object.entries(environment)) {
    if (!value || !/^postgres(?:ql)?:\/\//i.test(value)) continue;
    try { assertLocalReplayTarget(value); } catch { throw new Error(`Refusing remote connection variable ${name}`); }
  }
  for (const name of LINKED_PROJECT_VARIABLES) if (environment[name]) throw new Error(`Refusing linked-project variable ${name}`);
  return true;
}

export function sanitizedChildEnvironment(environment = process.env) {
  assertSafeLocalReplayEnvironment(environment);
  return {
    ...environment,
    POSTGRES_URL: "",
    DATABASE_URL: "",
    PGHOST: "",
    PGPORT: "",
    PGSERVICE: "",
    SUPABASE_DB_URL: "",
    SUPABASE_URL: "",
    PUBLIC_SUPABASE_URL: "",
    SUPABASE_PROJECT_REF: "",
    SUPABASE_ACCESS_TOKEN: "",
    SUPABASE_DB_PASSWORD: "",
    SUPABASE_WORKDIR: "",
  };
}

function projectIdFor(runId) {
  return `ogl-replay-${assertRunId(runId)}`;
}

function rootTemplateFor(runId) {
  return path.join(os.tmpdir(), `openglass-local-disposable-supabase-${assertRunId(runId)}-`);
}

function fingerprintEvidenceTemplateFor(runId) {
  return path.join(os.tmpdir(), `${FINGERPRINT_EVIDENCE_PREFIX}${assertRunId(runId)}-`);
}

export function assertOwnedFingerprintEvidenceRoot({ evidenceRoot, runtimeRoot, repositoryRoot }) {
  const evidence = path.resolve(evidenceRoot);
  const runtime = path.resolve(runtimeRoot);
  const temp = path.resolve(os.tmpdir());
  if (!isWithin(evidence, temp)
    || path.resolve(path.dirname(evidence)) !== temp
    || !path.basename(evidence).startsWith(FINGERPRINT_EVIDENCE_PREFIX)
    || evidence === temp
    || isWithin(evidence, repositoryRoot)
    || isWithin(evidence, runtime)
    || isWithin(runtime, evidence)) {
    throw new Error("Fingerprint evidence root must be a designated owned temporary directory outside the disposable runtime and repository");
  }
  return evidence;
}

async function createFingerprintEvidence({ runId, runtimeRoot, repositoryRoot }) {
  const evidenceRoot = await mkdtemp(fingerprintEvidenceTemplateFor(runId));
  const ownedRoot = assertOwnedFingerprintEvidenceRoot({ evidenceRoot, runtimeRoot, repositoryRoot });
  return {
    root: ownedRoot,
    candidatePath: path.join(ownedRoot, "fingerprint-candidate.json"),
    reviewPath: path.join(ownedRoot, "fingerprint-review.json"),
    failureReceiptPath: path.join(ownedRoot, FAILURE_RECEIPT_FILENAME),
    startDiagnosticPath: path.join(ownedRoot, START_DIAGNOSTIC_FILENAME),
  };
}

function assertExactObjectKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Fingerprint evidence has an invalid object shape");
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error("Fingerprint evidence has an unknown or missing field");
}

function assertSafeEvidenceValue(value) {
  if (typeof value === "string" && SENSITIVE_EVIDENCE_VALUE.test(value)) throw new Error("Fingerprint evidence contains credential-like content");
  if (Array.isArray(value)) {
    for (const entry of value) assertSafeEvidenceValue(entry);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (SENSITIVE_EVIDENCE_KEY.test(key)) throw new Error("Fingerprint evidence contains a sensitive field");
      assertSafeEvidenceValue(entry);
    }
  }
}

export function sanitizeSupabaseStartDiagnosticText(value) {
  let text = typeof value === "string" ? value : String(value ?? "");
  text = text
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi, REDACTED)
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*@[^\s"'<>]+/gi, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
    .replace(/\b(?:bearer|basic)\s+[^\s,;]+/gi, REDACTED)
    .replace(/\b(?:authorization|proxy-authorization|x-api-key|x-auth-token|cookie)\s*:\s*[^\r\n]+/gi, REDACTED)
    .replace(/\b(?:database_url|(?:supabase|cloudflare|cf)_[a-z0-9_]+|(?:access|refresh|id)[_-]?token|password|passwd|passphrase|api[_-]?key|token|secret)\s*[=:]\s*[^\s,;]+/gi, REDACTED)
    .replace(/-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)? PRIVATE KEY-----/g, REDACTED);
  return SENSITIVE_EVIDENCE_VALUE.test(text) || SENSITIVE_NAMED_VALUE.test(text) ? REDACTED : text;
}

function assertString(value) {
  if (typeof value !== "string") throw new Error("Fingerprint evidence has an invalid scalar field");
}

function assertStringOrNull(value) {
  if (value !== null && typeof value !== "string") throw new Error("Fingerprint evidence has an invalid scalar field");
}

function assertCount(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Fingerprint evidence has an invalid count field");
}

function sanitizeFailureCode(value) {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : "UNSPECIFIED";
}

function startFailureDiagnosticFromOutput(output) {
  const text = typeof output === "string" ? output : String(output ?? "");
  if (/\bvector\b/i.test(text) && /(?:host[ -]?network|network).*(?:unreachable|unavailable|not reachable)|(?:unreachable|unavailable|not reachable).*(?:host[ -]?network|network)/i.test(text)) return "VECTOR_HOST_NETWORK_UNREACHABLE";
  if (/\b(?:eaddrinuse|address already in use|port .*?(?:already in use|already allocated)|bind: .*?(?:in use|allocated))\b/i.test(text)) return "PORT_CONFLICT";
  if (/\b(?:config(?:uration)?(?:\.toml)? .*?(?:invalid|malformed|parse)|(?:invalid|malformed|parse) .*?config(?:uration)?(?:\.toml)?)\b/i.test(text)) return "CONFIG_INVALID";
  if (/\b(?:docker (?:daemon|engine).*?(?:unavailable|not running|not found)|cannot connect to (?:the )?docker|docker .*?(?:is not running|not found|unavailable))\b/i.test(text)) return "DOCKER_UNAVAILABLE";
  if (/\b(?:health(?: ?check)? .*?(?:failed|unhealthy|timeout)|(?:failed|unhealthy|timeout).*?health(?: ?check)?|service .*?unhealthy)\b/i.test(text)) return "SERVICE_HEALTH_FAILED";
  return "UNKNOWN";
}

function preferredStartFailureDiagnostic(current, candidate) {
  const priority = ["UNKNOWN", "SERVICE_HEALTH_FAILED", "DOCKER_UNAVAILABLE", "CONFIG_INVALID", "PORT_CONFLICT", "VECTOR_HOST_NETWORK_UNREACHABLE"];
  return priority.indexOf(candidate) > priority.indexOf(current) ? candidate : current;
}

export function classifySupabaseStartFailure({ stdout = "", stderr = "" } = {}) {
  return preferredStartFailureDiagnostic(
    startFailureDiagnosticFromOutput(stdout),
    startFailureDiagnosticFromOutput(stderr),
  );
}

function rawStartDiagnosticPaths(runtimeRoot) {
  const root = path.resolve(runtimeRoot);
  return {
    rawStdoutPath: path.join(root, "supabase-start.stdout.raw"),
    rawStderrPath: path.join(root, "supabase-start.stderr.raw"),
  };
}

function assertOwnedRawStartDiagnosticPath({ candidate, runtimeRoot }) {
  const root = path.resolve(runtimeRoot);
  const resolved = path.resolve(candidate);
  if (!isWithin(resolved, root) || path.dirname(resolved) !== root || !["supabase-start.stdout.raw", "supabase-start.stderr.raw"].includes(path.basename(resolved))) {
    throw new Error("Raw start diagnostic must remain inside the owned disposable runtime root");
  }
  return resolved;
}

async function readOwnedRawStartDiagnostic({ rawPath, runtimeRoot }) {
  const ownedPath = assertOwnedRawStartDiagnosticPath({ candidate: rawPath, runtimeRoot });
  try {
    const stats = await lstat(ownedPath);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("Raw start diagnostic is not a regular file");
    return await readFile(ownedPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  } finally {
    await rm(ownedPath, { force: true });
  }
}

function firstFatalNonsecretContext({ stdout, stderr, classification }) {
  const terms = classification === "VECTOR_HOST_NETWORK_UNREACHABLE"
    ? /(?:fatal|error|failed|vector|host[ -]?network|unreachable|unavailable|not reachable)/i
    : /(?:fatal|error|failed|failure|invalid|unhealthy|timeout|unreachable|unavailable|not reachable|already in use|already allocated|cannot connect)/i;
  for (const line of `${stdout}\n${stderr}`.split(/\r?\n/)) {
    if (!terms.test(line)) continue;
    const context = sanitizeSupabaseStartDiagnosticText(line).trim().slice(0, MAX_DIAGNOSTIC_CONTEXT_LENGTH);
    if (context && context !== REDACTED) return context;
  }
  return null;
}

function assertStartDiagnosticSchema(diagnostic) {
  assertExactObjectKeys(diagnostic, START_DIAGNOSTIC_KEYS);
  if (diagnostic.format !== "openglass-local-disposable-supabase-start-diagnostic-v1") throw new Error("Start diagnostic has an invalid format");
  if (!START_FAILURE_DIAGNOSTICS.has(diagnostic.classification) || diagnostic.classification === "NOT_APPLICABLE") throw new Error("Start diagnostic has an invalid classification");
  if (typeof diagnostic.firstFatalContext !== "string" || !diagnostic.firstFatalContext || diagnostic.firstFatalContext.length > MAX_DIAGNOSTIC_CONTEXT_LENGTH) throw new Error("Start diagnostic has an invalid context");
  if (SENSITIVE_NAMED_VALUE.test(diagnostic.firstFatalContext)) throw new Error("Start diagnostic contains credential-like content");
  assertSafeEvidenceValue(diagnostic);
  return true;
}

async function captureSanitizedStartDiagnostic({ runtimeRoot, evidence, repositoryRoot, rawPaths }) {
  const [stdout, stderr] = await Promise.all([
    readOwnedRawStartDiagnostic({ rawPath: rawPaths.rawStdoutPath, runtimeRoot }),
    readOwnedRawStartDiagnostic({ rawPath: rawPaths.rawStderrPath, runtimeRoot }),
  ]);
  const classification = classifySupabaseStartFailure({ stdout, stderr });
  const firstFatalContext = firstFatalNonsecretContext({ stdout, stderr, classification });
  if (!firstFatalContext) return null;
  const diagnostic = {
    format: "openglass-local-disposable-supabase-start-diagnostic-v1",
    classification,
    firstFatalContext,
  };
  assertOwnedFingerprintEvidenceRoot({ evidenceRoot: evidence.root, runtimeRoot, repositoryRoot });
  if (evidence.startDiagnosticPath !== path.join(evidence.root, START_DIAGNOSTIC_FILENAME)) throw new Error("Start diagnostic path must remain inside its owned evidence root");
  assertStartDiagnosticSchema(diagnostic);
  await writeFile(evidence.startDiagnosticPath, `${JSON.stringify(diagnostic, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return diagnostic;
}

function startFailureDiagnosticFor(stage, value) {
  if (stage !== "supabase-start-owned-root") return "NOT_APPLICABLE";
  return START_FAILURE_DIAGNOSTICS.has(value) && value !== "NOT_APPLICABLE" ? value : "UNKNOWN";
}

function failureReceiptFor({ runId, stage, error, cleanupStatus }) {
  const exitCode = Number.isSafeInteger(error?.exitCode) && error.exitCode >= 1 && error.exitCode <= 255 ? error.exitCode : null;
  return {
    format: "openglass-local-disposable-supabase-failure-receipt-v1",
    runId: assertRunId(runId),
    stage,
    class: exitCode === null ? RUNTIME_FAILURE_CLASSES.get(stage) : "command-exit",
    exitCode,
    code: exitCode === null ? sanitizeFailureCode(error?.code) : null,
    startDiagnostic: startFailureDiagnosticFor(stage, error?.startDiagnostic),
    cleanupStatus,
  };
}

export function assertFailureReceiptSchema(receipt) {
  assertExactObjectKeys(receipt, FAILURE_RECEIPT_KEYS);
  if (receipt.format !== "openglass-local-disposable-supabase-failure-receipt-v1") throw new Error("Failure receipt has an invalid format");
  assertRunId(receipt.runId);
  if (!RUNTIME_FAILURE_CLASSES.has(receipt.stage)) throw new Error("Failure receipt has an invalid stage");
  if (receipt.class !== "command-exit" && receipt.class !== RUNTIME_FAILURE_CLASSES.get(receipt.stage)) throw new Error("Failure receipt has an invalid class");
  const hasExitCode = Number.isSafeInteger(receipt.exitCode) && receipt.exitCode >= 1 && receipt.exitCode <= 255;
  const hasCode = typeof receipt.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(receipt.code);
  if (hasExitCode === hasCode || (hasExitCode && receipt.class !== "command-exit") || (!hasExitCode && receipt.class === "command-exit")) throw new Error("Failure receipt must contain exactly one sanitized failure code");
  if (!START_FAILURE_DIAGNOSTICS.has(receipt.startDiagnostic)
    || (receipt.stage === "supabase-start-owned-root" && receipt.startDiagnostic === "NOT_APPLICABLE")
    || (receipt.stage !== "supabase-start-owned-root" && receipt.startDiagnostic !== "NOT_APPLICABLE")) throw new Error("Failure receipt has an invalid start diagnostic");
  if (receipt.cleanupStatus !== "completed" && receipt.cleanupStatus !== "failed") throw new Error("Failure receipt has an invalid cleanup status");
  assertSafeEvidenceValue(receipt);
  return true;
}

async function writeFailureReceipt({ evidence, runtimeRoot, repositoryRoot, receipt }) {
  assertOwnedFingerprintEvidenceRoot({ evidenceRoot: evidence.root, runtimeRoot, repositoryRoot });
  const receiptPath = path.join(evidence.root, FAILURE_RECEIPT_FILENAME);
  if (evidence.failureReceiptPath && evidence.failureReceiptPath !== receiptPath) throw new Error("Failure receipt path must remain inside its owned evidence root");
  assertFailureReceiptSchema(receipt);
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return receiptPath;
}

function parseEvidenceJson(text) {
  try { return JSON.parse(text); } catch { throw new Error("Fingerprint evidence is not valid JSON"); }
}

function assertFingerprintCandidateSchema(candidate) {
  assertExactObjectKeys(candidate, CANDIDATE_KEYS);
  if (candidate.format !== "openglass-production-schema-fingerprint-v1" || candidate.generatedFrom !== "LOCAL_DOCKER_ONLY") throw new Error("Fingerprint evidence candidate is incomplete");
  for (const key of ["canonicalMigrationCount", "legalConsentPrerequisiteCount", "objectCount"]) assertCount(candidate[key]);
  if (!Array.isArray(candidate.localMigrationLedger) || !Array.isArray(candidate.objects) || candidate.canonicalMigrationCount !== candidate.localMigrationLedger.length || candidate.objectCount !== candidate.objects.length) throw new Error("Fingerprint evidence candidate is incomplete");
  for (const entry of candidate.localMigrationLedger) {
    assertExactObjectKeys(entry, LEDGER_ENTRY_KEYS);
    assertString(entry.version);
    assertString(entry.name);
    assertCount(entry.statementCount);
  }
  for (const entry of candidate.objects) {
    assertExactObjectKeys(entry, OBJECT_ENTRY_KEYS);
    for (const key of ["objectType", "schema", "name", "identity", "attribute", "normalizedStructuralDefinition", "deterministicSha256", "label"]) assertString(entry[key]);
    assertStringOrNull(entry.firstIntroducedMigration);
    if (!Array.isArray(entry.sourceMigrations) || !Array.isArray(entry.laterModifyingMigrations) || !entry.sourceMigrations.every((item) => typeof item === "string") || !entry.laterModifyingMigrations.every((item) => typeof item === "string") || typeof entry.securityRelevant !== "boolean" || typeof entry.legalConsentPrerequisite !== "boolean") throw new Error("Fingerprint evidence candidate is incomplete");
  }
  assertSafeEvidenceValue(candidate);
}

function assertFingerprintReviewSchema(review) {
  assertExactObjectKeys(review, REVIEW_KEYS);
  if (review.format !== "openglass-production-schema-fingerprint-review-v1" || typeof review.classification !== "string" || typeof review.fixtureMatchesCandidate !== "boolean" || !/^[a-f0-9]{64}$/.test(review.reviewId)) throw new Error("Fingerprint evidence review is incomplete");
  assertExactObjectKeys(review.expected, REVIEW_EXPECTED_SCOPE_KEYS);
  for (const key of REVIEW_EXPECTED_SCOPE_KEYS) assertCount(review.expected[key]);
  assertExactObjectKeys(review.candidate, REVIEW_CANDIDATE_SCOPE_KEYS);
  assertString(review.candidate.generatedFrom);
  for (const key of REVIEW_EXPECTED_SCOPE_KEYS) assertCount(review.candidate[key]);
  assertExactObjectKeys(review.migrationLedger, REVIEW_LEDGER_KEYS);
  assertCount(review.migrationLedger.expectedCount);
  assertCount(review.migrationLedger.candidateCount);
  if (!Array.isArray(review.migrationLedger.missingFromCandidate) || !Array.isArray(review.migrationLedger.addedByCandidate) || typeof review.migrationLedger.orderMatchesForSharedEntries !== "boolean") throw new Error("Fingerprint evidence review is incomplete");
  for (const entry of [...review.migrationLedger.missingFromCandidate, ...review.migrationLedger.addedByCandidate]) {
    assertExactObjectKeys(entry, REVIEW_LEDGER_ENTRY_KEYS);
    assertString(entry.version);
    assertString(entry.name);
  }
  assertExactObjectKeys(review.objectIdentity, REVIEW_OBJECT_KEYS);
  if (!Object.values(review.objectIdentity).every((entries) => Array.isArray(entries) && entries.every((entry) => typeof entry === "string"))) throw new Error("Fingerprint evidence review is incomplete");
  assertSafeEvidenceValue(review);
}

async function readReviewableFingerprintEvidence({ evidence, expected }) {
  const [candidateStats, reviewStats] = await Promise.all([lstat(evidence.candidatePath), lstat(evidence.reviewPath)]);
  if (!candidateStats.isFile() || candidateStats.isSymbolicLink() || !reviewStats.isFile() || reviewStats.isSymbolicLink()) {
    throw new Error("Fingerprint evidence must contain regular candidate and review files");
  }
  const [candidateText, reviewText] = await Promise.all([readFile(evidence.candidatePath, "utf8"), readFile(evidence.reviewPath, "utf8")]);
  const candidate = parseEvidenceJson(candidateText);
  const review = parseEvidenceJson(reviewText);
  assertFingerprintCandidateSchema(candidate);
  assertFingerprintReviewSchema(review);
  const expectedReview = reviewFingerprintCandidate({ expected, candidate });
  if (JSON.stringify(review) !== JSON.stringify(expectedReview)) throw new Error("Fingerprint evidence review is stale or modified");
  if (review.fixtureMatchesCandidate) throw new Error("Fingerprint evidence may be retained only for a review mismatch");
  return expectedReview;
}

function supabaseArgs(action, root, extra = []) {
  return ["--no-install", "supabase", action, ...extra, "--workdir", root];
}

export function buildLocalDisposableReplayPlan({ root = process.cwd(), runId = randomUUID().replace(/-/g, "").slice(0, 8), startupOnly = false } = {}) {
  const id = assertRunId(runId);
  const projectId = projectIdFor(id);
  const runtimeRoot = rootTemplateFor(id);
  const command = (name, executable, args) => ({ name, command: executable, args });
  const startupSteps = [
    command("supabase-init-owned-root", "npx", supabaseArgs("init", runtimeRoot, ["--yes"])),
    command("supabase-start-owned-root", "npx", supabaseArgs("start", runtimeRoot)),
    command("validate-local-status-target", "npx", supabaseArgs("status", runtimeRoot, ["--output", "json"])),
    command("validate-owned-postgres-container", "docker", ["exec", "<owned-container-id>", "psql", "-X", "-U", "postgres", "-d", "postgres", "--csv"]),
    command("validate-empty-migration-ledger", "docker", ["exec", "<owned-container-id>", "psql", "-X", "-U", "postgres", "-d", "postgres", "--csv"]),
    command("supabase-stop-owned-root-no-backup", "npx", supabaseArgs("stop", runtimeRoot, ["--no-backup"])),
    command("remove-verified-owned-root", "node", ["owned-root-cleanup", runtimeRoot]),
  ];
  return {
    dryRun: true,
    startupOnly,
    repositoryRoot: path.resolve(root),
    runtimeRoot,
    projectId,
    remoteConnections: 0,
    steps: startupOnly ? startupSteps : [
      command("supabase-init-owned-root", "npx", supabaseArgs("init", runtimeRoot, ["--yes"])),
      command("build-current-canonical-mirror", "node", ["scripts/build-local-supabase-replay-mirror.mjs", "--output", path.join(runtimeRoot, "supabase", "migrations"), "--mapping", path.join(runtimeRoot, "mapping.json")]),
      command("supabase-start-owned-root", "npx", supabaseArgs("start", runtimeRoot)),
      command("validate-local-status-target", "npx", supabaseArgs("status", runtimeRoot, ["--output", "json"])),
      command("validate-owned-postgres-container", "docker", ["exec", "<owned-container-id>", "psql", "-X", "-U", "postgres", "-d", "postgres", "--csv"]),
      command("validate-migration-ledger", "docker", ["exec", "<owned-container-id>", "psql", "-X", "-U", "postgres", "-d", "postgres", "--csv"]),
      command("fingerprint-through-owned-container-unix-socket", "docker", ["exec", "<owned-container-id>", "psql", "-X", "-U", "postgres", "-d", "postgres", "--csv"]),
      command("supabase-stop-owned-root-no-backup", "npx", supabaseArgs("stop", runtimeRoot, ["--no-backup"])),
      command("remove-verified-owned-root", "node", ["owned-root-cleanup", runtimeRoot]),
    ],
  };
}

export async function runCommand(executable, args, { cwd, env, input, inspectSupabaseStartFailure = false, diagnosticCapture } = {}) {
  if (diagnosticCapture) {
    if (!diagnosticCapture.rawStdoutPath || !diagnosticCapture.rawStderrPath) throw new Error("Diagnostic capture requires owned stdout and stderr paths");
    await Promise.all([
      writeFile(diagnosticCapture.rawStdoutPath, "", { encoding: "utf8", flag: "wx" }),
      writeFile(diagnosticCapture.rawStderrPath, "", { encoding: "utf8", flag: "wx" }),
    ]);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(executable), stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let startDiagnostic = "UNKNOWN";
    const writes = [];
    const inspectStartOutput = (chunk, stream) => {
      startDiagnostic = preferredStartFailureDiagnostic(startDiagnostic, classifySupabaseStartFailure({ [stream]: chunk }));
    };
    child.stdout.on("data", (chunk) => {
      if (inspectSupabaseStartFailure) inspectStartOutput(chunk, "stdout");
      if (diagnosticCapture) writes.push(appendFile(diagnosticCapture.rawStdoutPath, chunk));
      else stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (inspectSupabaseStartFailure) inspectStartOutput(chunk, "stderr");
      if (diagnosticCapture) writes.push(appendFile(diagnosticCapture.rawStderrPath, chunk));
      else stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", async (code) => {
      try {
        await Promise.all(writes);
      } catch (error) {
        reject(error);
        return;
      }
      if (code === 0) resolve({ stdout, stderr });
      else {
        const error = new Error(`${executable} exited ${code}`);
        error.exitCode = code;
        if (inspectSupabaseStartFailure) error.startDiagnostic = startDiagnostic;
        reject(error);
      }
    });
    if (input) child.stdin.end(input);
  });
}

function replaceConfigField(text, section, key, value) {
  const escapedSection = section.replace(/[.]/g, "\\.");
  const pattern = section
    ? new RegExp(`(\\[${escapedSection}\\][\\s\\S]*?\\n${key}\\s*=\\s*)\\d+`, "m")
    : new RegExp(`(^${key}\\s*=\\s*)"[^"]*"`, "m");
  const replacement = section ? `$1${value}` : `$1"${value}"`;
  const changed = text.replace(pattern, replacement);
  if (changed === text) throw new Error(`Generated Supabase config lacks ${section ? `${section}.${key}` : key}`);
  return changed;
}

async function portIsFree(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(true));
  });
}

async function selectPortBundle(runId) {
  const seed = Number.parseInt(assertRunId(runId).slice(0, 4), 16) % 500;
  for (let offset = 0; offset < 500; offset += 1) {
    const base = 56000 + ((seed + offset) % 500) * 10;
    const ports = PORT_FIELDS.map(([, , portOffset]) => base + portOffset);
    if (ports.every((port) => port > 0 && port < 65536) && (await Promise.all(ports.map(portIsFree))).every(Boolean)) return { base, ports };
  }
  throw new Error("No complete local Supabase port bundle is available");
}

async function initializeOwnedConfig({ runtimeRoot, projectId, runId, execute, environment }) {
  await execute(NPX, supabaseArgs("init", runtimeRoot, ["--yes"]), { cwd: runtimeRoot, env: environment });
  const configPath = path.join(runtimeRoot, "supabase", "config.toml");
  let config = await readFile(configPath, "utf8");
  const bundle = await selectPortBundle(runId);
  config = replaceConfigField(config, "", "project_id", projectId);
  for (let index = 0; index < PORT_FIELDS.length; index += 1) {
    const [section, key] = PORT_FIELDS[index];
    config = replaceConfigField(config, section, key, bundle.ports[index]);
  }
  await writeFile(configPath, config, "utf8");
  return { configPath, ports: bundle.ports };
}

function parseCsvRows(csv) {
  const lines = String(csv).trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 1 || lines[0] !== "version,name") throw new Error("Malformed local migration ledger CSV");
  return lines.slice(1).map((line) => {
    const [version, name, ...extra] = line.split(",");
    if (!version || !name || extra.length) throw new Error("Malformed local migration ledger row");
    return { version, name };
  });
}

function expectedLedgerRows(mappings) {
  return mappings.map(({ temporaryVersion, temporaryFile }) => ({
    version: temporaryVersion,
    name: temporaryFile.replace(/^\d+_/, "").replace(/\.sql$/, ""),
  }));
}

export function verifyLocalMigrationLedger({ mappings, rows }) {
  const expected = expectedLedgerRows(mappings);
  if (rows.length !== expected.length) throw new Error(`Local migration ledger count differs: expected ${expected.length}, received ${rows.length}`);
  for (let index = 0; index < expected.length; index += 1) {
    if (rows[index]?.version !== expected[index].version || rows[index]?.name !== expected[index].name) {
      throw new Error(`Local migration ledger order differs at position ${index + 1}`);
    }
  }
  return true;
}

function parseMigrationLedgerRelationExists(csv) {
  const lines = String(csv).trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== 2 || lines[0] !== "relation_exists") throw new Error("Malformed local migration ledger relation CSV");
  if (lines[1] === "t") return true;
  if (lines[1] === "f") return false;
  throw new Error("Malformed local migration ledger relation value");
}

export function verifyEmptyLocalMigrationLedger(rows) {
  if (!Array.isArray(rows) || rows.length !== 0) throw new Error("Fresh local migration ledger must be empty before replay");
  return true;
}

async function inspectEmptyLocalMigrationLedger({ execute, environment, containerId }) {
  const relationExists = parseMigrationLedgerRelationExists(await executeUnixSocketPsql({
    execute,
    environment,
    containerId,
    sql: "SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS relation_exists;\n",
  }));
  if (!relationExists) return { rowCount: 0, state: "UNINITIALIZED_EMPTY" };
  const rows = parseCsvRows(await executeUnixSocketPsql({
    execute,
    environment,
    containerId,
    sql: "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;\n",
  }));
  verifyEmptyLocalMigrationLedger(rows);
  return { rowCount: 0, state: "INITIALIZED_EMPTY" };
}

async function listContainers(execute, environment) {
  const { stdout } = await execute("docker", ["ps", "--format", "{{.ID}}\t{{.Names}}"], { env: environment });
  return new Map(stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [id, name] = line.split("\t");
    return [name, id];
  }));
}

function resolveOwnedContainer({ before, after, projectId }) {
  const name = `supabase_db_${projectId}`;
  const id = after.get(name);
  if (!id || before.has(name)) throw new Error("Owned disposable Supabase database container was not created");
  return { id, name };
}

async function executeUnixSocketPsql({ execute, environment, containerId, sql }) {
  const { stdout } = await execute("docker", ["exec", "-i", containerId, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "--csv"], { env: environment, input: sql });
  return stdout;
}

export async function cleanupOwnedDisposableReplay({ runtimeRoot, repositoryRoot, startAttempted, execute, environment, removeRoot = rm }) {
  const ownedRoot = assertOwnedDisposableRoot({ disposableRoot: runtimeRoot, repositoryRoot });
  let cleanupError;
  try {
    if (startAttempted) await execute(NPX, supabaseArgs("stop", ownedRoot, ["--no-backup"]), { cwd: ownedRoot, env: environment });
  } catch (error) { cleanupError = error; }
  try {
    await removeRoot(ownedRoot, { recursive: true, force: true });
  } catch (error) { cleanupError ??= error; }
  if (cleanupError) throw new Error(`Disposable Supabase replay cleanup failed: ${cleanupError.message}`);
  return true;
}

export async function runLocalDisposableReplay({ root = process.cwd(), runId = randomUUID().replace(/-/g, "").slice(0, 8), environment = process.env, execute = runCommand, createFingerprintEvidence: createEvidence = createFingerprintEvidence, dryRun = false, diagnosticStartFailure = false, startupOnly = false } = {}) {
  if (startupOnly && diagnosticStartFailure) throw new Error("Startup-only mode forbids diagnostic start capture");
  const plan = buildLocalDisposableReplayPlan({ root, runId, startupOnly });
  if (dryRun) return plan;
  const repositoryRoot = path.resolve(root);
  const safeEnvironment = sanitizedChildEnvironment(environment);
  const runtimeRoot = await mkdtemp(rootTemplateFor(runId));
  const projectId = projectIdFor(runId);
  let fingerprintEvidence;
  let retainFingerprintEvidence = false;
  let startAttempted = false;
  let currentStage;
  let runtimeFailure;
  let primaryError;
  let result;
  try {
    assertOwnedDisposableRoot({ disposableRoot: runtimeRoot, repositoryRoot });
    fingerprintEvidence = await createEvidence({ runId, runtimeRoot, repositoryRoot });
    assertOwnedFingerprintEvidenceRoot({ evidenceRoot: fingerprintEvidence.root, runtimeRoot, repositoryRoot });
    if (fingerprintEvidence.candidatePath !== path.join(fingerprintEvidence.root, "fingerprint-candidate.json") || fingerprintEvidence.reviewPath !== path.join(fingerprintEvidence.root, "fingerprint-review.json") || fingerprintEvidence.failureReceiptPath !== path.join(fingerprintEvidence.root, FAILURE_RECEIPT_FILENAME) || fingerprintEvidence.startDiagnosticPath !== path.join(fingerprintEvidence.root, START_DIAGNOSTIC_FILENAME)) throw new Error("Fingerprint evidence paths must remain inside their owned root");
    const before = await listContainers(execute, safeEnvironment);
    await initializeOwnedConfig({ runtimeRoot, projectId, runId, execute, environment: safeEnvironment });
    const mirror = startupOnly ? undefined : await buildLocalSupabaseReplayMirror({
      canonicalDirectory: path.join(repositoryRoot, "supabase", "migrations"),
      outputDirectory: path.join(runtimeRoot, "supabase", "migrations"),
      mappingPath: path.join(runtimeRoot, "mapping.json"),
      repositoryRoot,
    });
    startAttempted = true;
    currentStage = "supabase-start-owned-root";
    const diagnosticCapture = !startupOnly && diagnosticStartFailure ? rawStartDiagnosticPaths(runtimeRoot) : undefined;
    try {
      await execute(NPX, supabaseArgs("start", runtimeRoot), { cwd: runtimeRoot, env: safeEnvironment, inspectSupabaseStartFailure: true, diagnosticCapture });
      if (diagnosticCapture) await Promise.all([
        rm(diagnosticCapture.rawStdoutPath, { force: true }),
        rm(diagnosticCapture.rawStderrPath, { force: true }),
      ]);
    } catch (error) {
      if (diagnosticCapture) {
        try {
          const diagnostic = await captureSanitizedStartDiagnostic({ runtimeRoot, evidence: fingerprintEvidence, repositoryRoot, rawPaths: diagnosticCapture });
          if (diagnostic) error.startDiagnostic = diagnostic.classification;
        } catch {
          error.startDiagnostic = error.startDiagnostic ?? "UNKNOWN";
        }
      }
      throw error;
    }
    currentStage = "validate-local-status-target";
    const status = JSON.parse((await execute(NPX, supabaseArgs("status", runtimeRoot, ["--output", "json"]), { cwd: runtimeRoot, env: safeEnvironment })).stdout);
    assertLocalReplayTarget(status.API_URL);
    currentStage = "validate-owned-postgres-container";
    const container = resolveOwnedContainer({ before, after: await listContainers(execute, safeEnvironment), projectId });
    if (startupOnly) {
      currentStage = "validate-empty-migration-ledger";
      const emptyMigrationLedger = await inspectEmptyLocalMigrationLedger({
        execute,
        environment: safeEnvironment,
        containerId: container.id,
      });
      result = {
        localStartup: "PASS",
        localReplayTarget: "DISPOSABLE",
        startupOnly: true,
        canonicalMigrationCount: 0,
        migrationLedger: "EMPTY",
        emptyMigrationLedger,
        schemaFingerprintTarget: "NOT_RUN",
        schemaFingerprintProductionConnection: false,
        remoteConnections: 0,
      };
    } else {
      currentStage = "validate-migration-ledger";
      const ledger = parseCsvRows(await executeUnixSocketPsql({
        execute,
        environment: safeEnvironment,
        containerId: container.id,
        sql: "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;\n",
      }));
      verifyLocalMigrationLedger({ mappings: mirror.mappings, rows: ledger });
      currentStage = "capture-schema-fingerprint";
      try {
        await execute("node", ["scripts/test-production-schema-fingerprint.mjs"], {
          cwd: repositoryRoot,
          env: {
            ...safeEnvironment,
            OPENGLASS_LOCAL_DISPOSABLE_DB_CONTAINER: container.id,
            OPENGLASS_LOCAL_DISPOSABLE_PROJECT_ID: projectId,
            OPENGLASS_LOCAL_DISPOSABLE_FINGERPRINT_CANDIDATE: fingerprintEvidence.candidatePath,
            OPENGLASS_LOCAL_DISPOSABLE_FINGERPRINT_REVIEW: fingerprintEvidence.reviewPath,
          },
        });
      } catch {
        let review;
        try {
          review = await readReviewableFingerprintEvidence({ evidence: fingerprintEvidence, expected: JSON.parse(await readFile(path.join(repositoryRoot, "tests", "fixtures", "production-schema-expected-fingerprint.json"), "utf8")) });
        } catch (evidenceError) {
          throw new Error(`Fingerprint candidate failed and its evidence was rejected: ${evidenceError.message}`);
        }
        retainFingerprintEvidence = true;
        throw new Error(`Fingerprint candidate failed; Non-secret fingerprint evidence retained for explicit review:\n  candidate: ${fingerprintEvidence.candidatePath}\n  review: ${fingerprintEvidence.reviewPath}\n  review id: ${review.reviewId}`);
      }
      result = {
        localReplay: "PASS",
        localReplayTarget: "DISPOSABLE",
        schemaFingerprintTarget: "LOCAL_DISPOSABLE",
        schemaFingerprintProductionConnection: false,
        canonicalMigrationCount: mirror.migrationCount,
        migrationLedger: "PASS",
        remoteConnections: 0,
      };
    }
  } catch (error) {
    primaryError = error;
    if (RUNTIME_FAILURE_CLASSES.has(currentStage)) runtimeFailure = { stage: currentStage, error };
  }

  let cleanupStatus = "completed";
  let cleanupError;
  try {
    try {
      await cleanupOwnedDisposableReplay({ runtimeRoot, repositoryRoot, startAttempted, execute, environment: safeEnvironment });
    } catch (error) {
      cleanupStatus = "failed";
      cleanupError = error;
      runtimeFailure ??= { stage: "cleanup-owned-root", error };
    }
    if (runtimeFailure && fingerprintEvidence) {
      if (!retainFingerprintEvidence) {
        await Promise.all([
          rm(fingerprintEvidence.candidatePath, { force: true }),
          rm(fingerprintEvidence.reviewPath, { force: true }),
        ]);
      }
      if (runtimeFailure.stage !== "supabase-start-owned-root") await rm(fingerprintEvidence.startDiagnosticPath, { force: true });
      const receiptPath = await writeFailureReceipt({
        evidence: fingerprintEvidence,
        runtimeRoot,
        repositoryRoot,
        receipt: failureReceiptFor({ runId, stage: runtimeFailure.stage, error: runtimeFailure.error, cleanupStatus }),
      });
      retainFingerprintEvidence = true;
      throw new Error(`Disposable Supabase replay failed; Non-secret replay failure receipt retained:\n  receipt: ${receiptPath}`);
    }
    if (primaryError) throw primaryError;
    if (cleanupError) throw cleanupError;
    return result;
  } finally {
    if (fingerprintEvidence && !retainFingerprintEvidence) await rm(fingerprintEvidence.root, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((argument) => !["--dry-run", "--diagnostic-start-failure", "--startup-only"].includes(argument))) throw new Error("Only --dry-run, --startup-only, and --diagnostic-start-failure are accepted; linked and remote Supabase options are forbidden");
  if (args.includes("--startup-only") && args.includes("--diagnostic-start-failure")) throw new Error("Startup-only mode forbids diagnostic start capture");
  const result = await runLocalDisposableReplay({
    dryRun: args.includes("--dry-run"),
    diagnosticStartFailure: args.includes("--diagnostic-start-failure"),
    startupOnly: args.includes("--startup-only"),
  });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
