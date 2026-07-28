import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { validateR6V3DryRunTerminal } from "./validate-r6-v3-dry-run-terminal.mjs";
import { FINAL_AUTHORIZATION_VERSION, getMinimalCanaryMutationPlan, validateDryRunAuthorization } from "./r6-final-canary-execution-contract.mjs";

const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1] ?? null; };
const sha256 = (raw) => createHash("sha256").update(raw).digest("hex");
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
async function json(file, code) { try { const raw = await readFile(file); return { raw, value: JSON.parse(raw.toString("utf8")) }; } catch { fail(code); } }
async function durableWrite(file, value) { await mkdir(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; const handle = await open(tmp, "wx", 0o600); try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); } finally { await handle.close(); } await rename(tmp, file); }

const dryTerminalPath = arg("--dry-run-terminal"); const orchestrationPath = arg("--dry-run-orchestration-terminal"); const receiptPath = arg("--dry-run-receipt"); const output = arg("--output");
if (!dryTerminalPath || !orchestrationPath || !receiptPath || !output) fail("R6_FINAL_AUTHORIZATION_ARGUMENTS_INVALID");
const dry = await json(dryTerminalPath, "R6_FINAL_DRY_RUN_TERMINAL_INVALID"); validateR6V3DryRunTerminal(dry.value);
const orchestration = await json(orchestrationPath, "R6_FINAL_DRY_RUN_ORCHESTRATION_INVALID"); const receipt = await json(receiptPath, "R6_FINAL_DRY_RUN_RECEIPT_INVALID");
if (!dry.value.success || dry.value.outerClassification !== "R6_CURRENT_CANONICAL_V3_DRY_RUN_ONLY_READY" || dry.value.actualMutationCount !== 0 || dry.value.supabaseWriteCount !== 0 || dry.value.productionMutationCount !== 0 || dry.value.retryCount !== 0 || dry.value.plannedMutationCount !== 2 || receipt.value.state !== "CONSUMED" || receipt.value.runId !== dry.value.runId || orchestration.value.runId !== dry.value.runId || orchestration.value.success !== true || orchestration.value.dryRunSuccess !== true || orchestration.value.executionCommit !== dry.value.executionCommit) fail("R6_FINAL_DRY_RUN_EVIDENCE_INELIGIBLE");
const plan = getMinimalCanaryMutationPlan();
const authorization = { schemaVersion: FINAL_AUTHORIZATION_VERSION, dryRunRunId: dry.value.runId, dryRunTerminalPath: path.resolve(dryTerminalPath), dryRunTerminalSha256: sha256(dry.raw), dryRunOrchestrationTerminalPath: path.resolve(orchestrationPath), dryRunOrchestrationTerminalSha256: sha256(orchestration.raw), executionCommit: dry.value.executionCommit, toolingCommit: dry.value.expectedToolingCommit, plan, plannedMutationCount: 2, actualMutationCount: 0, supabaseWriteCount: 0, productionMutationCount: 0, retryCount: 0, successClassification: dry.value.outerClassification };
validateDryRunAuthorization(authorization, { executionCommit: dry.value.executionCommit, toolingCommit: dry.value.expectedToolingCommit });
await durableWrite(path.resolve(output), authorization);
process.stdout.write("R6_FINAL_DRY_RUN_AUTHORIZATION_READY\n");
