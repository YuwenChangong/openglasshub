import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createFileJournalStore, findUnfinishedJournals } from "./production-minimal-canary-journal.mjs";
import { execFileSync } from "node:child_process";
import { CANARY_APPROVAL, createJournal, createMarkers, executeMinimalCanary, recoverMinimalCanary, validateCanaryRunId } from "./production-minimal-canary-core.mjs";
import { createProductionMinimalCanaryHttpAdapter } from "./production-minimal-canary-http-adapter.mjs";
import { printQaWriteGuardError, readQaWriteGuardConfig, validateQaWriteTarget } from "./target-write-guard.mjs";

const CANONICAL_PRODUCTION_URL = "https://openglasshub.pages.dev";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function arg(name, argv) { const index = argv.indexOf(name); return index < 0 ? null : String(argv[index + 1] ?? "").trim() || null; }
function parse(argv) {
  const execute = argv.includes("--execute");
  const recoverRun = arg("--recover-run", argv); const runId = arg("--run-id", argv); const confirmRun = arg("--confirm-run", argv); const confirmRecovery = arg("--confirm-recovery", argv);
  if ((execute ? 1 : 0) + (recoverRun ? 1 : 0) > 1 || (argv.includes("--dry-run") && (execute || recoverRun))) throw new Error("QA_CANARY_MODE_INVALID");
  const dryRun = !execute && !recoverRun;
  return { execute, dryRun, recoverRun, runId, confirmRun, confirmRecovery };
}
function requireEnv(name) { const value = String(process.env[name] ?? "").trim(); if (!value) throw new Error(`QA_CANARY_ENV_REQUIRED:${name}`); return value; }
function redact(value) { const text = String(value ?? ""); return text.length < 12 ? "[redacted]" : `${text.slice(0, 6)}...${text.slice(-4)}`; }
function config(options) {
  const target = validateQaWriteTarget(readQaWriteGuardConfig(process.env, options.confirmRun));
  const baseUrl = requireEnv("QA_BASE_URL").replace(/\/+$/, "");
  if (baseUrl !== CANONICAL_PRODUCTION_URL || !target.productionTarget) throw new Error("QA_CANARY_PRODUCTION_TARGET_REQUIRED");
  const qaUserId = requireEnv("QA_CANARY_USER_ID"); if (!UUID.test(qaUserId)) throw new Error("QA_CANARY_USER_ID_INVALID");
  const expectedCommit = requireEnv("QA_EXPECTED_DEPLOYED_COMMIT");
  return { target: { baseUrl, supabaseRef: target.actualRef }, qaUserId, expectedCommit, supabaseUrl: requireEnv("QA_SUPABASE_URL"), anonKey: requireEnv("QA_CANARY_SUPABASE_ANON_KEY"), accessToken: requireEnv("QA_CANARY_ACCESS_TOKEN"), circleSlug: requireEnv("QA_CANARY_CIRCLE_SLUG") };
}
function enforceExecution(options, cfg) {
  if (!options.execute && !options.recoverRun) return;
  if (process.env.CI) throw new Error("QA_CANARY_CI_EXECUTION_DENIED");
  if (process.env.QA_ALLOW_PRODUCTION_WRITES !== "1") throw new Error("QA_PRODUCTION_WRITES_DISABLED");
  if (process.env.QA_CANARY_APPROVAL !== CANARY_APPROVAL) throw new Error("QA_CANARY_APPROVAL_REQUIRED");
  const localHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (localHead !== cfg.expectedCommit) throw new Error("QA_CANARY_DEPLOYED_COMMIT_MISMATCH");
  if (options.recoverRun) {
    if (!/^qa-recover-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(options.confirmRecovery ?? ""))) throw new Error("QA_CANARY_RECOVERY_CONFIRMATION_INVALID");
  } else if (!options.confirmRun || options.confirmRun !== options.runId) throw new Error("QA_CANARY_CONFIRMATION_MISMATCH");
  validateCanaryRunId(options.recoverRun ?? options.runId);
  return cfg;
}
function safeSummary(journal) { return { runId: journal.runId, state: journal.state, target: { baseUrl: journal.target.baseUrl, supabaseRef: redact(journal.target.supabaseRef) }, cleanup: journal.cleanup, artifacts: { post: journal.artifacts.post ? redact(journal.artifacts.post.id) : null, comment: journal.artifacts.comment ? redact(journal.artifacts.comment.id) : null } }; }
async function main() {
  const options = parse(process.argv.slice(2));
  const cfg = config(options);
  const runId = options.recoverRun ?? options.runId;
  if (!runId) throw new Error("QA_CANARY_RUN_ID_REQUIRED");
  validateCanaryRunId(runId);
  const store = createFileJournalStore(process.env.QA_CANARY_JOURNAL_ROOT, runId);
  if (options.dryRun) {
    if (await store.exists()) throw new Error("QA_CANARY_RUN_ID_REUSED");
    console.log(JSON.stringify({ phase: "PLAN", runId, target: { baseUrl: cfg.target.baseUrl, supabaseRef: redact(cfg.target.supabaseRef) }, scope: ["one post", "one attached comment", "exact soft-delete cleanup", "exact residue verification"], journalPath: store.path, noWrites: true }, null, 2));
    return;
  }
  enforceExecution(options, cfg);
  const adapter = createProductionMinimalCanaryHttpAdapter(cfg);
  if (options.recoverRun) {
    if (!(await store.exists())) throw new Error("QA_CANARY_JOURNAL_NOT_FOUND");
    const result = await recoverMinimalCanary({ adapter, store, journal: await store.read(), recoveryConfirmationHash: createHash("sha256").update(options.confirmRecovery).digest("hex") });
    console.log(JSON.stringify({ phase: "RECOVERY", ...safeSummary(result.journal), alreadyClean: result.alreadyClean }, null, 2));
    return;
  }
  if ((await findUnfinishedJournals(process.env.QA_CANARY_JOURNAL_ROOT, cfg.qaUserId)).length > 0) throw new Error("QA_CANARY_UNFINISHED_RUN_EXISTS");
  if (await store.exists()) throw new Error("QA_CANARY_RUN_ID_REUSED");
  const journal = createJournal({ runId, target: cfg.target, qaUserId: cfg.qaUserId, expectedCommit: cfg.expectedCommit, markers: createMarkers(runId) });
  const completed = await executeMinimalCanary({ adapter, store, journal });
  console.log(JSON.stringify({ phase: "COMPLETE", ...safeSummary(completed), journalSha256: createHash("sha256").update(JSON.stringify(completed)).digest("hex") }, null, 2));
}
main().catch((error) => { const message = String(error?.message ?? "QA_CANARY_FAILED").replace(/eyJ[A-Za-z0-9._-]+/g, "[redacted-jwt]"); console.error(`QA_CANARY_FAILED: ${message}`); process.exitCode = 1; });
