import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { createFileJournalStore } from "./production-minimal-canary-journal.mjs";
import { readConsumedRunReceipt } from "./production-minimal-canary-consumed-run-registry.mjs";
import { FINAL_POSTFLIGHT_VERSION, getMinimalCanaryMutationPlan, validateFinalExecutionTerminal, validateFinalPostflight } from "./r6-final-canary-execution-contract.mjs";
import { createProductionMinimalCanaryPostflightReadAdapter } from "./production-minimal-canary-http-adapter.mjs";

const arg = (name, argv = process.argv) => { const index = argv.indexOf(name); return index < 0 ? null : argv[index + 1] ?? null; };
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const readJson = async (file, code) => { try { const raw = await readFile(file); return { raw, value: JSON.parse(raw.toString("utf8")) }; } catch { fail(code); } };
const isoNow = () => new Date().toISOString();
async function atomicWrite(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  if (await stat(file).then(() => true).catch(() => false)) fail("R6_FINAL_POSTFLIGHT_OUTPUT_EXISTS");
  const temporary = `${file}.${process.pid}.tmp`; const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temporary, file); } catch (error) { await rm(temporary, { force: true }); throw error; }
}
function noWriteResult({ startedAt, productionRunId, parentDryRunRunId, executionTerminalPath, executionTerminalSha256, liveReceiptPath, liveReceiptSha256, journalPath, journalSha256, mutationPlanHash, executionCommit, toolingCommit }) {
  return { schemaVersion: FINAL_POSTFLIGHT_VERSION, startedAt, completedAt: isoNow(), outerClassification: "R6_FINAL_CANARY_READ_ONLY_POSTFLIGHT_FAILED", innerClassification: null, failureStage: "POSTFLIGHT", success: false, productionRunId, parentDryRunRunId, executionTerminalPath, executionTerminalSha256, executionTerminalValidated: false, liveReceiptPath, liveReceiptSha256, liveReceiptState: "PENDING", receiptVerified: false, journalPath, journalSha256, journalVerified: false, mutationPlanHash, approvedMutationCount: 2, executionActualMutationCount: 0, verifiedMutationCount: 0, unexpectedMutationCount: 0, duplicateExecutionCount: 0, executionCommit, toolingCommit, commitBindingPassed: false, supabaseReadCount: 0, supabaseWriteCount: 0, productionMutationCountDuringPostflight: 0 };
}
export async function runReadOnlyPostflight({ executionTerminalPath, executionTerminalSha256, receiptPath, receiptSha256, registryRoot, journalRoot, outputPath, readVerifier, now = isoNow } = {}) {
  const startedAt = now(); let terminal; let receipt; let journal; let result;
  let productionRunId = "qa-canary-00000000-0000-4000-8000-000000000000"; let parentDryRunRunId = "qa-canary-00000000-0000-4000-8000-000000000001"; let executionCommit = "0".repeat(40); let toolingCommit = executionCommit; let journalPath = path.join(String(journalRoot ?? ""), "unknown", "journal.json"); let journalSha256 = "0".repeat(64); let mutationPlanHash = getMinimalCanaryMutationPlan().planSha256;
  try {
    const execution = await readJson(executionTerminalPath, "R6_FINAL_EXECUTION_TERMINAL_MISSING");
    if (sha256(execution.raw) !== executionTerminalSha256) fail("R6_FINAL_EXECUTION_TERMINAL_HASH_MISMATCH"); terminal = validateFinalExecutionTerminal(execution.value);
    productionRunId = terminal.productionRunId; parentDryRunRunId = terminal.parentDryRunRunId; executionCommit = terminal.executionCommit; toolingCommit = terminal.toolingCommit; mutationPlanHash = terminal.mutationPlanHash; journalPath = terminal.journalPath; journalSha256 = terminal.journalSha256;
    if (!terminal.success || terminal.actualMutationCount !== 2 || terminal.productionMutationCount !== 2 || !terminal.childTerminalValidated) fail("R6_FINAL_POSTFLIGHT_EXECUTION_INELIGIBLE");
    const loadedReceipt = await readConsumedRunReceipt({ root: registryRoot, receiptPath, expectedSha256: receiptSha256 }); receipt = loadedReceipt.receipt;
    if (receipt.state !== "CONSUMED" || receipt.mode !== "live" || receipt.runId !== productionRunId || receipt.finalAuthorizationBinding?.dryRunRunId !== parentDryRunRunId || receipt.finalAuthorizationBinding?.planSha256 !== mutationPlanHash || receipt.finalAuthorizationBinding?.executionCommit !== executionCommit) fail("R6_FINAL_POSTFLIGHT_RECEIPT_BINDING_INVALID");
    const store = createFileJournalStore(journalRoot, productionRunId); if (store.path !== journalPath) fail("R6_FINAL_POSTFLIGHT_JOURNAL_PATH_INVALID"); journal = await store.read(); const journalRaw = await readFile(journalPath);
    if (sha256(journalRaw) !== journalSha256 || journal.runId !== productionRunId || journal.state !== "COMPLETE" || journal.prepared?.runnerCommit !== executionCommit || journal.cleanup?.comment !== "COMPLETE" || journal.cleanup?.post !== "COMPLETE" || journal.cleanup?.residue !== "COMPLETE") fail("R6_FINAL_POSTFLIGHT_JOURNAL_INVALID");
    if (typeof readVerifier !== "function") fail("R6_FINAL_POSTFLIGHT_READ_ADAPTER_REQUIRED");
    const verification = await readVerifier(journal);
    result = { schemaVersion: FINAL_POSTFLIGHT_VERSION, startedAt, completedAt: isoNow(), outerClassification: "R6_FINAL_CANARY_READ_ONLY_POSTFLIGHT_COMPLETE", innerClassification: null, failureStage: null, success: true, productionRunId, parentDryRunRunId, executionTerminalPath, executionTerminalSha256, executionTerminalValidated: true, liveReceiptPath: receiptPath, liveReceiptSha256: receiptSha256, liveReceiptState: receipt.state, receiptVerified: true, journalPath, journalSha256, journalVerified: true, mutationPlanHash, approvedMutationCount: 2, executionActualMutationCount: terminal.actualMutationCount, verifiedMutationCount: verification.verifiedMutationCount, unexpectedMutationCount: verification.unexpectedMutationCount, duplicateExecutionCount: verification.duplicateExecutionCount, executionCommit, toolingCommit, commitBindingPassed: toolingCommit === executionCommit, supabaseReadCount: verification.readCount, supabaseWriteCount: 0, productionMutationCountDuringPostflight: 0 };
    validateFinalPostflight(result);
  } catch (error) {
    result = noWriteResult({ startedAt, productionRunId, parentDryRunRunId, executionTerminalPath, executionTerminalSha256, liveReceiptPath: receiptPath, liveReceiptSha256: receiptSha256, journalPath, journalSha256, mutationPlanHash, executionCommit, toolingCommit });
    result.innerClassification = error?.code ?? "R6_FINAL_POSTFLIGHT_UNEXPECTED_FAILURE"; result.failureStage = "EVIDENCE_VALIDATION";
  }
  if (outputPath) await atomicWrite(outputPath, result);
  return result;
}
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const remote = process.argv.includes("--verify-remote");
  const adapter = remote ? createProductionMinimalCanaryPostflightReadAdapter({ baseUrl: process.env.QA_BASE_URL, accessToken: process.env.QA_CANARY_ACCESS_TOKEN, requestTimeoutMs: Number.parseInt(process.env.QA_CANARY_REQUEST_TIMEOUT_MS ?? "30000", 10) }) : null;
  const result = await runReadOnlyPostflight({ executionTerminalPath: arg("--execution-terminal"), executionTerminalSha256: arg("--execution-terminal-sha256"), receiptPath: arg("--receipt"), receiptSha256: arg("--receipt-sha256"), registryRoot: arg("--registry-root"), journalRoot: arg("--journal-root"), outputPath: arg("--output"), readVerifier: adapter ? (journal) => adapter.verifyCompletedJournal(journal) : null });
  process.stdout.write(`${result.outerClassification}\n`); if (!result.success) process.exitCode = 1;
}
