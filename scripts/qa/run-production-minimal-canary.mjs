import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createFileJournalStore, findUnfinishedJournals } from "./production-minimal-canary-journal.mjs";
import { CANARY_APPROVAL, createJournal, createMarkers, executeMinimalCanary, recoverMinimalCanary, validateCanaryRunId } from "./production-minimal-canary-core.mjs";
import { createProductionMinimalCanaryHttpAdapter } from "./production-minimal-canary-http-adapter.mjs";
import { validateProductionWriteAcknowledgement, readQaWriteGuardConfig, validateQaWriteTarget } from "./target-write-guard.mjs";
import { validateDeploymentAttestation, validateExpectedRunnerCommit } from "./production-deployment-attestation.mjs";

const CANONICAL_PRODUCTION_URL = "https://openglasshub.pages.dev";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREVIOUSLY_FAILED_RUN_IDS = new Set(["qa-canary-d5d9eed0-a599-4cf6-be98-39e2060d2340"]);
export const RUNNER_REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function arg(name, argv) { const index = argv.indexOf(name); return index < 0 ? null : String(argv[index + 1] ?? "").trim() || null; }
export function parse(argv) {
  const execute = argv.includes("--execute");
  const recoverRun = arg("--recover-run", argv); const runId = arg("--run-id", argv); const confirmRun = arg("--confirm-run", argv); const confirmRecovery = arg("--confirm-recovery", argv);
  if ((execute ? 1 : 0) + (recoverRun ? 1 : 0) > 1 || (argv.includes("--dry-run") && (execute || recoverRun))) throw new Error("QA_CANARY_MODE_INVALID");
  return { execute, dryRun: !execute && !recoverRun, recoverRun, runId, confirmRun, confirmRecovery };
}

function requireEnv(name, env = process.env) { const value = String(env[name] ?? "").trim(); if (!value) throw new Error(`QA_CANARY_ENV_REQUIRED:${name}`); return value; }
function requireFullLowerSha(value, code) { const text = String(value ?? ""); if (!/^[a-f0-9]{40}$/.test(text)) throw new Error(code); return text; }
function redact(value) { const text = String(value ?? ""); return text.length < 12 ? "[redacted]" : `${text.slice(0, 6)}...${text.slice(-4)}`; }

export function resolveRunnerRepositoryRoot() { return RUNNER_REPOSITORY_ROOT; }

export function readRunnerCommit(repositoryRoot = RUNNER_REPOSITORY_ROOT) {
  const commit = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  return requireFullLowerSha(commit, "QA_CANARY_RUNNER_COMMIT_MISMATCH");
}

export function validateRunnerCommit({ expectedRunnerCommit, repositoryRoot = RUNNER_REPOSITORY_ROOT }) {
  const expected = validateExpectedRunnerCommit(expectedRunnerCommit);
  const observed = readRunnerCommit(repositoryRoot);
  if (observed !== expected) throw new Error("QA_CANARY_RUNNER_COMMIT_MISMATCH");
  return observed;
}

function readIdentityConfig(env = process.env) {
  return {
    expectedRunnerCommit: validateExpectedRunnerCommit(requireEnv("QA_EXPECTED_RUNNER_COMMIT", env)),
    expectedDeployedCommit: requireFullLowerSha(requireEnv("QA_EXPECTED_DEPLOYED_COMMIT", env), "QA_CANARY_DEPLOYED_COMMIT_MISMATCH"),
    attestationPath: requireEnv("QA_DEPLOYMENT_ATTESTATION_PATH", env),
    attestationSha256: requireEnv("QA_DEPLOYMENT_ATTESTATION_SHA256", env),
  };
}

export function config(options, identities, env = process.env) {
  const target = validateQaWriteTarget({ ...readQaWriteGuardConfig(env, options.confirmRun), deferProductionAcknowledgement: true });
  const baseUrl = requireEnv("QA_BASE_URL", env).replace(/\/+$/, "");
  if (baseUrl !== CANONICAL_PRODUCTION_URL || !target.productionTarget) throw new Error("QA_CANARY_PRODUCTION_TARGET_REQUIRED");
  const qaUserId = requireEnv("QA_CANARY_USER_ID", env); if (!UUID.test(qaUserId)) throw new Error("QA_CANARY_USER_ID_INVALID");
  return {
    target: { baseUrl, supabaseRef: target.actualRef }, qaUserId,
    expectedCommit: identities.expectedDeployedCommit,
    supabaseUrl: requireEnv("QA_SUPABASE_URL", env), anonKey: requireEnv("QA_CANARY_SUPABASE_ANON_KEY", env),
    accessToken: requireEnv("QA_CANARY_ACCESS_TOKEN", env), circleSlug: requireEnv("QA_CANARY_CIRCLE_SLUG", env),
    productionTarget: target.productionTarget,
  };
}

function enforceLiveConfirmation(options, cfg, env = process.env) {
  if (!options.execute && !options.recoverRun) return;
  if (env.CI) throw new Error("QA_CANARY_CI_EXECUTION_DENIED");
  if (env.QA_CANARY_APPROVAL !== CANARY_APPROVAL) throw new Error("QA_CANARY_APPROVAL_REQUIRED");
  if (options.recoverRun) {
    if (!/^qa-recover-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(options.confirmRecovery ?? ""))) throw new Error("QA_CANARY_RECOVERY_CONFIRMATION_INVALID");
  } else if (!options.confirmRun || options.confirmRun !== options.runId) throw new Error("QA_CANARY_CONFIRMATION_MISMATCH");
  return cfg;
}

function safeSummary(journal) {
  return { runId: journal.runId, state: journal.state, target: { baseUrl: journal.target.baseUrl, supabaseRef: redact(journal.target.supabaseRef) }, cleanup: journal.cleanup, artifacts: { post: journal.artifacts.post ? redact(journal.artifacts.post.id) : null, comment: journal.artifacts.comment ? redact(journal.artifacts.comment.id) : null } };
}

export async function validateIdentityGuards({ options, env = process.env, now = Date.now(), attestationRoot } = {}) {
  const identities = readIdentityConfig(env);
  const runnerCommit = validateRunnerCommit({ expectedRunnerCommit: identities.expectedRunnerCommit });
  const cfg = config(options, identities, env);
  const attestation = await validateDeploymentAttestation({
    attestationPath: identities.attestationPath,
    expectedSha256: identities.attestationSha256,
    expectedCommit: identities.expectedDeployedCommit,
    now,
    root: attestationRoot,
  });
  validateProductionWriteAcknowledgement({ productionTarget: cfg.productionTarget, allowProductionWrites: env.QA_ALLOW_PRODUCTION_WRITES, confirmRun: options.confirmRun });
  return { cfg, runnerCommit, attestation };
}

export async function main(argv = process.argv.slice(2), env = process.env, dependencies = {}) {
  const options = parse(argv);
  resolveRunnerRepositoryRoot();
  const { cfg, runnerCommit, attestation } = await validateIdentityGuards({ options, env, attestationRoot: dependencies.attestationRoot });
  const runId = options.recoverRun ?? options.runId;
  if (!runId) throw new Error("QA_CANARY_RUN_ID_REQUIRED");
  validateCanaryRunId(runId);
  if (PREVIOUSLY_FAILED_RUN_IDS.has(runId)) throw new Error("QA_CANARY_RUN_ID_PREVIOUSLY_FAILED");
  const store = createFileJournalStore(env.QA_CANARY_JOURNAL_ROOT, runId);
  if (options.dryRun) {
    if (await store.exists()) throw new Error("QA_CANARY_RUN_ID_REUSED");
    console.log(JSON.stringify({ phase: "PLAN", runId, runnerCommit, deploymentId: attestation.deploymentId, target: { baseUrl: cfg.target.baseUrl, supabaseRef: redact(cfg.target.supabaseRef) }, scope: ["one post", "one attached comment", "exact soft-delete cleanup", "exact residue verification"], journalPath: store.path, noWrites: true }, null, 2));
    return;
  }
  enforceLiveConfirmation(options, cfg, env);
  const adapter = (dependencies.createAdapter ?? createProductionMinimalCanaryHttpAdapter)(cfg);
  if (options.recoverRun) {
    if (!(await store.exists())) throw new Error("QA_CANARY_JOURNAL_NOT_FOUND");
    const result = await recoverMinimalCanary({ adapter, store, journal: await store.read(), recoveryConfirmationHash: createHash("sha256").update(options.confirmRecovery).digest("hex") });
    console.log(JSON.stringify({ phase: "RECOVERY", ...safeSummary(result.journal), alreadyClean: result.alreadyClean }, null, 2));
    return;
  }
  if ((await findUnfinishedJournals(env.QA_CANARY_JOURNAL_ROOT, cfg.qaUserId)).length > 0) throw new Error("QA_CANARY_UNFINISHED_RUN_EXISTS");
  if (await store.exists()) throw new Error("QA_CANARY_RUN_ID_REUSED");
  const journal = createJournal({ runId, target: cfg.target, qaUserId: cfg.qaUserId, expectedCommit: cfg.expectedCommit, markers: createMarkers(runId) });
  const completed = await executeMinimalCanary({ adapter, store, journal });
  console.log(JSON.stringify({ phase: "COMPLETE", ...safeSummary(completed), journalSha256: createHash("sha256").update(JSON.stringify(completed)).digest("hex") }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = String(error?.message ?? "QA_CANARY_FAILED").replace(/eyJ[A-Za-z0-9._-]+/g, "[redacted-jwt]");
    console.error(`QA_CANARY_FAILED: ${message}`);
    process.exitCode = 1;
  });
}
