import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createFileJournalStore, findUnfinishedJournals } from "./production-minimal-canary-journal.mjs";
import { CANARY_APPROVAL, RECOVERY_APPROVAL, COMMENT_TEMPLATE_VERSION, POST_TEMPLATE_VERSION, CANONICAL_ENCODING_VERSION, PAGINATION_CONTRACT_VERSION, RECOVERY_QUERY_CONTRACT_VERSION, createJournal, createMarkers, contentFor, executeMinimalCanary, recoverMinimalCanary, validateCanaryRunId } from "./production-minimal-canary-core.mjs";
import { createProductionMinimalCanaryHttpAdapter, createProductionMinimalCanaryReadAdapter, createProductionMinimalCanaryRecoveryAdapter } from "./production-minimal-canary-http-adapter.mjs";
import { validateProductionWriteAcknowledgement, readQaWriteGuardConfig, validateQaWriteTarget } from "./target-write-guard.mjs";
import { validateDeploymentAttestation, validateExpectedRunnerCommit } from "./production-deployment-attestation.mjs";
import { assertReservedRunMayUseReceipt, consumeReservationReceipt } from "./production-minimal-canary-consumed-run-registry.mjs";

const CANONICAL_PRODUCTION_URL = "https://openglasshub.pages.dev";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANARY_RUN_ID = /^qa-canary-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMIT = /^[a-f0-9]{40}$/;
const MIN_ATTESTATION_VALIDITY_MS = 12 * 60 * 1000;
export const MINIMAL_CANARY_CHILD_TERMINAL_VERSION = "qa-minimal-canary-child-terminal-result-v1";
export const RUNNER_REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function arg(name, argv) { const index = argv.indexOf(name); return index < 0 ? null : String(argv[index + 1] ?? "").trim() || null; }
export function parse(argv) {
  const execute = argv.includes("--execute");
  const recoverRun = arg("--recover-run", argv); const runId = arg("--run-id", argv); const confirmRun = arg("--confirm-run", argv); const confirmRecovery = arg("--confirm-recovery", argv); const childTerminalPath = arg("--child-terminal-path", argv);
  if ((execute ? 1 : 0) + (recoverRun ? 1 : 0) > 1 || (argv.includes("--dry-run") && (execute || recoverRun))) throw new Error("QA_CANARY_MODE_INVALID");
  return { execute, dryRun: !execute && !recoverRun, recoverRun, runId, confirmRun, confirmRecovery, childTerminalPath };
}
function requireEnv(name, env = process.env) { const value = String(env[name] ?? "").trim(); if (!value) throw new Error(`QA_CANARY_ENV_REQUIRED:${name}`); return value; }
function requireFullLowerSha(value, code) { const text = String(value ?? ""); if (!/^[a-f0-9]{40}$/.test(text)) throw new Error(code); return text; }
function redact(value) { const text = String(value ?? ""); return text.length < 12 ? "[redacted]" : `${text.slice(0, 6)}...${text.slice(-4)}`; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function requestTimeoutMs(env) { const value = Number.parseInt(String(env.QA_CANARY_REQUEST_TIMEOUT_MS ?? "30000"), 10); if (!Number.isInteger(value) || value < 1000 || value > 120000) throw new Error("QA_CANARY_TIMEOUT_INVALID"); return value; }
function protectedMode(options) { return options.recoverRun ? "recovery" : (options.execute ? "live" : "dry-run"); }
function handoffConfig(env = process.env) {
  return {
    root: requireEnv("QA_CANARY_CONSUMED_RUN_REGISTRY_ROOT", env),
    receiptPath: requireEnv("QA_CANARY_CONSUMED_RUN_RECEIPT_PATH", env),
    receiptSha256: requireEnv("QA_CANARY_CONSUMED_RUN_RECEIPT_SHA256", env),
    invocationNonce: requireEnv("QA_CANARY_CONSUMED_RUN_NONCE", env),
    wrapperVersion: requireEnv("QA_CANARY_WRAPPER_VERSION", env),
    wrapperSha256: requireEnv("QA_CANARY_WRAPPER_SHA256", env),
    childCommandDigest: requireEnv("QA_CANARY_CHILD_COMMAND_SHA256", env),
  };
}

export function resolveRunnerRepositoryRoot() { return RUNNER_REPOSITORY_ROOT; }
export function readRunnerCommit(repositoryRoot = RUNNER_REPOSITORY_ROOT) { return requireFullLowerSha(execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), "QA_CANARY_RUNNER_COMMIT_MISMATCH"); }
export function validateRunnerCommit({ expectedRunnerCommit, repositoryRoot = RUNNER_REPOSITORY_ROOT }) { const expected = validateExpectedRunnerCommit(expectedRunnerCommit); const observed = readRunnerCommit(repositoryRoot); if (observed !== expected) throw new Error("QA_CANARY_RUNNER_COMMIT_MISMATCH"); return observed; }

export async function consumeWrapperReservation({ runId, options, env = process.env, repositoryRoot = RUNNER_REPOSITORY_ROOT }) {
  const runnerCommit = readRunnerCommit(repositoryRoot);
  const root = requireEnv("QA_CANARY_CONSUMED_RUN_REGISTRY_ROOT", env);
  await assertReservedRunMayUseReceipt({ root, runId });
  const handoff = handoffConfig(env);
  return consumeReservationReceipt({ root: handoff.root, receiptPath: handoff.receiptPath, receiptSha256: handoff.receiptSha256, invocationNonce: handoff.invocationNonce, runId, mode: protectedMode(options), runnerCommit, wrapperVersion: handoff.wrapperVersion, wrapperSha256: handoff.wrapperSha256, childCommandDigest: handoff.childCommandDigest });
}

function optionalToolingCommit(env = process.env) {
  const value = String(env.QA_EXPECTED_TOOLING_COMMIT ?? "").trim();
  if (!value) return null;
  return requireFullLowerSha(value, "QA_CANARY_V3_ATTESTATION_TOOLING_COMMIT_MISSING");
}
function readIdentityConfig(env = process.env) {
  const expectedRunnerCommit = validateExpectedRunnerCommit(requireEnv("QA_EXPECTED_RUNNER_COMMIT", env));
  const expectedToolingCommit = optionalToolingCommit(env);
  if (expectedToolingCommit !== null && expectedToolingCommit !== expectedRunnerCommit) throw new Error("QA_CANARY_V3_ATTESTATION_TOOLING_COMMIT_MISMATCH");
  return { expectedRunnerCommit, expectedToolingCommit, expectedDeployedCommit: requireFullLowerSha(requireEnv("QA_EXPECTED_DEPLOYED_COMMIT", env), "QA_CANARY_DEPLOYED_COMMIT_MISMATCH"), attestationPath: requireEnv("QA_DEPLOYMENT_ATTESTATION_PATH", env), attestationSha256: requireEnv("QA_DEPLOYMENT_ATTESTATION_SHA256", env) };
}
export function config(options, identities, env = process.env) {
  const target = validateQaWriteTarget({ ...readQaWriteGuardConfig(env, options.confirmRun), deferProductionAcknowledgement: true });
  const baseUrl = requireEnv("QA_BASE_URL", env).replace(/\/+$/, "");
  if (baseUrl !== CANONICAL_PRODUCTION_URL || !target.productionTarget) throw new Error("QA_CANARY_PRODUCTION_TARGET_REQUIRED");
  return { target: { baseUrl, supabaseRef: target.actualRef }, expectedCommit: identities.expectedDeployedCommit, circleSlug: requireEnv("QA_CANARY_CIRCLE_SLUG", env), productionTarget: target.productionTarget, requestTimeoutMs: requestTimeoutMs(env) };
}
function liveCredentials(cfg, env) { return { ...cfg, supabaseUrl: requireEnv("QA_SUPABASE_URL", env), anonKey: requireEnv("QA_CANARY_SUPABASE_ANON_KEY", env), accessToken: requireEnv("QA_CANARY_ACCESS_TOKEN", env) }; }
function enforceLiveConfirmation(options, cfg, env = process.env) {
  if (!options.execute && !options.recoverRun) return;
  if (env.CI) throw new Error("QA_CANARY_CI_EXECUTION_DENIED");
  const expectedApproval = options.recoverRun ? RECOVERY_APPROVAL : CANARY_APPROVAL;
  if (env.QA_CANARY_APPROVAL !== expectedApproval) throw new Error("QA_CANARY_APPROVAL_REQUIRED");
  if (options.recoverRun) { if (!/^qa-recover-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(options.confirmRecovery ?? ""))) throw new Error("QA_CANARY_RECOVERY_CONFIRMATION_INVALID"); }
  else if (!options.confirmRun || options.confirmRun !== options.runId) throw new Error("QA_CANARY_CONFIRMATION_MISMATCH");
  validateProductionWriteAcknowledgement({ productionTarget: cfg.productionTarget, allowProductionWrites: env.QA_ALLOW_PRODUCTION_WRITES, confirmRun: options.confirmRun });
}
function safeSummary(journal) { return { runId: journal.runId, state: journal.state, target: { baseUrl: journal.prepared.baseUrl, supabaseRef: redact(journal.prepared.supabaseRefDigest) }, cleanup: journal.cleanup, artifacts: { post: journal.artifacts.post ? redact(journal.artifacts.post.id) : null, comment: journal.artifacts.comment ? redact(journal.artifacts.comment.id) : null } }; }
function assertFreshAttestation(attestation, now) { if (Date.parse(attestation.expiresAt) - now < MIN_ATTESTATION_VALIDITY_MS) throw new Error("QA_CANARY_ATTESTATION_VALIDITY_TOO_SHORT"); }
export async function validateIdentityGuards({ options, env = process.env, now = Date.now(), attestationRoot } = {}) {
  const identities = readIdentityConfig(env); const runnerCommit = validateRunnerCommit({ expectedRunnerCommit: identities.expectedRunnerCommit }); const cfg = config(options, identities, env);
  const attestation = await validateDeploymentAttestation({ attestationPath: identities.attestationPath, expectedSha256: identities.attestationSha256, expectedCommit: identities.expectedDeployedCommit, expectedToolingCommit: identities.expectedToolingCommit, now, root: attestationRoot });
  assertFreshAttestation(attestation, now);
  return { cfg, runnerCommit, expectedToolingCommit: identities.expectedToolingCommit, attestation, attestationSha256: identities.attestationSha256 };
}
function preparedRecord({ cfg, runnerCommit, attestation, attestationSha256, actor, circle, markers }) {
  const content = contentFor(markers);
  return { actorId: actor.id, circleId: circle.id, circleSlug: cfg.circleSlug, resolvedCircleSlug: circle.slug, runnerCommit, attestationSha256, deploymentId: attestation.deploymentId, deployedCommit: attestation.sourceCommit, baseUrl: cfg.target.baseUrl, supabaseRefDigest: sha256(cfg.target.supabaseRef), postMarker: markers.post, commentMarker: markers.comment, postTitleSha256: sha256(content.title), postBodySha256: sha256(content.body), commentBodySha256: sha256(content.comment), encodingVersion: CANONICAL_ENCODING_VERSION, postTemplateVersion: POST_TEMPLATE_VERSION, commentTemplateVersion: COMMENT_TEMPLATE_VERSION, recoveryQueryContractVersion: RECOVERY_QUERY_CONTRACT_VERSION, paginationContractVersion: PAGINATION_CONTRACT_VERSION, requestTimeoutMs: cfg.requestTimeoutMs, creationEnabled: true, recoveryOnly: false, plannedPostCount: 1, plannedCommentCount: 1, cleanupOrder: "comment-then-post", networkRetryPolicy: "zero" };
}
export async function main(argv = process.argv.slice(2), env = process.env, dependencies = {}) {
  const options = parse(argv); const runId = options.recoverRun ?? options.runId;
  if (!runId) throw new Error("QA_CANARY_RUN_ID_REQUIRED"); validateCanaryRunId(runId);
  // Receipt consumption is deliberately before target/attestation, credentials, adapters, or journal preparation.
  await consumeWrapperReservation({ runId, options, env, repositoryRoot: dependencies.repositoryRoot ?? RUNNER_REPOSITORY_ROOT });
  const { cfg, runnerCommit, expectedToolingCommit, attestation, attestationSha256 } = await validateIdentityGuards({ options, env, attestationRoot: dependencies.attestationRoot });
  const store = (dependencies.createStore ?? createFileJournalStore)(env.QA_CANARY_JOURNAL_ROOT, runId);
  if (options.dryRun) { if (await store.exists()) throw new Error("QA_CANARY_RUN_ID_REUSED"); console.log(JSON.stringify({ phase: "PLAN", runId, runnerCommit, deploymentId: attestation.deploymentId, target: { baseUrl: cfg.target.baseUrl, supabaseRef: redact(cfg.target.supabaseRef) }, scope: ["one post", "one attached comment", "exact soft-delete cleanup", "complete exact recovery only"], journalPath: store.path, noWrites: true }, null, 2)); return { runId, mode: "dry-run", runnerCommit, expectedToolingCommit, classification: "QA_CANARY_DRY_RUN_PLAN_READY", failureStage: "complete" }; }
  enforceLiveConfirmation(options, cfg, env);
  const credentials = liveCredentials(cfg, env);
  if (options.recoverRun) { if (!(await store.exists())) throw new Error("QA_CANARY_JOURNAL_NOT_FOUND"); const recoveryAdapter = (dependencies.createRecoveryAdapter ?? createProductionMinimalCanaryRecoveryAdapter)(credentials); const result = await recoverMinimalCanary({ recoveryAdapter, store, journal: await store.read(), recoveryConfirmationHash: sha256(options.confirmRecovery) }); console.log(JSON.stringify({ phase: "RECOVERY", ...safeSummary(result), noWrites: true }, null, 2)); return { runId, mode: "recovery", runnerCommit, expectedToolingCommit, classification: "QA_CANARY_RECOVERY_COMPLETE", failureStage: "complete" }; }
  const readAdapter = (dependencies.createReadAdapter ?? createProductionMinimalCanaryReadAdapter)(credentials); const actor = await readAdapter.authenticate(); if (!UUID.test(String(actor?.id ?? ""))) throw new Error("QA_CANARY_ACTOR_INVALID"); const circle = await readAdapter.resolveCircle({ slug: cfg.circleSlug }); if (!UUID.test(String(circle?.id ?? "")) || circle.slug !== cfg.circleSlug) throw new Error("QA_CANARY_CIRCLE_SCOPE_MISMATCH");
  if ((await findUnfinishedJournals(env.QA_CANARY_JOURNAL_ROOT, actor.id)).length > 0) throw new Error("QA_CANARY_UNFINISHED_RUN_EXISTS"); if (await store.exists()) throw new Error("QA_CANARY_RUN_ID_REUSED");
  const markers = createMarkers(runId); const journal = createJournal({ runId, prepared: preparedRecord({ cfg, runnerCommit, attestation, attestationSha256, actor, circle, markers }), markers }); await store.write(journal); const persisted = await store.read(); if (persisted.state !== "PREPARED" || persisted.prepared.actorId !== actor.id) throw new Error("QA_CANARY_PREPARED_JOURNAL_REREAD_MISMATCH");
  const adapter = (dependencies.createAdapter ?? createProductionMinimalCanaryHttpAdapter)(credentials); const completed = await executeMinimalCanary({ adapter, store, journal: persisted }); console.log(JSON.stringify({ phase: "COMPLETE", ...safeSummary(completed), journalSha256: sha256(JSON.stringify(completed)) }, null, 2)); return { runId, mode: "live", runnerCommit, expectedToolingCommit, classification: "QA_CANARY_EXECUTION_COMPLETE", failureStage: "complete" };
}

function childClassification(error) {
  const code = String(error?.message ?? "").trim();
  return /^QA_CANARY_[A-Z0-9_]+$/.test(code) && code !== "QA_CANARY_FAILED" ? code : "QA_CANARY_CHILD_UNEXPECTED_FAILURE";
}
function childFailureStage(classification) {
  return classification.startsWith("QA_CANARY_V3_ATTESTATION_") ? "V3_ATTESTATION_VALIDATION" : "CHILD_EXECUTION";
}
function childTerminalDigest(value) { const copy = { ...value }; delete copy.resultSha256; return sha256(JSON.stringify(copy)); }
function validateChildTerminalPath(value) {
  if (!value) return null;
  const resolved = path.resolve(value);
  if (!path.isAbsolute(resolved) || path.basename(resolved) !== "minimal-canary-child-terminal-result.json") throw new Error("QA_CANARY_CHILD_TERMINAL_PATH_INVALID");
  return resolved;
}
export function validateMinimalCanaryChildTerminal(value) {
  const required = ["schemaVersion", "runId", "mode", "runnerCommit", "expectedToolingCommit", "success", "classification", "failureStage", "childExitCode", "resultSha256"];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== required.length || required.some((key) => !(key in value))) throw new Error("QA_CANARY_CHILD_TERMINAL_INVALID");
  if (value.schemaVersion !== MINIMAL_CANARY_CHILD_TERMINAL_VERSION || !CANARY_RUN_ID.test(String(value.runId)) || !["dry-run", "live", "recovery"].includes(value.mode) || !COMMIT.test(String(value.runnerCommit)) || (value.expectedToolingCommit !== null && !COMMIT.test(String(value.expectedToolingCommit))) || typeof value.success !== "boolean" || !/^QA_CANARY_[A-Z0-9_]+$/.test(String(value.classification)) || typeof value.failureStage !== "string" || !Number.isInteger(value.childExitCode) || value.resultSha256 !== childTerminalDigest(value)) throw new Error("QA_CANARY_CHILD_TERMINAL_INVALID");
  if (value.success !== (value.childExitCode === 0) || (value.success && value.failureStage !== "complete") || (!value.success && value.classification === "QA_CANARY_FAILED")) throw new Error("QA_CANARY_CHILD_TERMINAL_INVALID");
  return Object.freeze(value);
}
async function writeChildTerminal(terminalPath, value) {
  const resolved = validateChildTerminalPath(terminalPath);
  if (!resolved) return null;
  const parent = path.dirname(resolved);
  const parentStat = await stat(parent).catch(() => { throw new Error("QA_CANARY_CHILD_TERMINAL_PATH_INVALID"); });
  if (!parentStat.isDirectory()) throw new Error("QA_CANARY_CHILD_TERMINAL_PATH_INVALID");
  const terminal = { ...value, resultSha256: null }; terminal.resultSha256 = childTerminalDigest(terminal); validateMinimalCanaryChildTerminal(terminal);
  const raw = Buffer.from(`${JSON.stringify(terminal)}\n`);
  const temporary = `${resolved}.${process.pid}.${Date.now()}.tmp`;
  try { const handle = await open(temporary, "wx", 0o600); try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); } await rename(temporary, resolved); }
  catch (error) { await rm(temporary, { force: true }); throw error; }
  return terminal;
}
async function runEntrypoint(argv, env) {
  const options = parse(argv); const terminalPath = validateChildTerminalPath(options.childTerminalPath);
  try {
    const result = await main(argv, env);
    await writeChildTerminal(terminalPath, { schemaVersion: MINIMAL_CANARY_CHILD_TERMINAL_VERSION, runId: result.runId, mode: result.mode, runnerCommit: result.runnerCommit, expectedToolingCommit: result.expectedToolingCommit, success: true, classification: result.classification, failureStage: result.failureStage, childExitCode: 0 });
  } catch (error) {
    const runId = options.recoverRun ?? options.runId;
    const runnerCommit = (() => { try { return readRunnerCommit(); } catch { return "0".repeat(40); } })();
    const expectedToolingCommit = optionalToolingCommit(env);
    if (terminalPath && CANARY_RUN_ID.test(String(runId))) {
      try { await writeChildTerminal(terminalPath, { schemaVersion: MINIMAL_CANARY_CHILD_TERMINAL_VERSION, runId, mode: protectedMode(options), runnerCommit, expectedToolingCommit, success: false, classification: childClassification(error), failureStage: childFailureStage(childClassification(error)), childExitCode: 1 }); } catch {}
    }
    throw error;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runEntrypoint(process.argv.slice(2), process.env).catch((error) => { const message = String(error?.message ?? "QA_CANARY_FAILED").replace(/eyJ[A-Za-z0-9._-]+/g, "[redacted-jwt]"); console.error(`QA_CANARY_FAILED: ${message}`); process.exitCode = 1; });
