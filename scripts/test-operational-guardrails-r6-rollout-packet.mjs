import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFile(path.join(root, "docs", "ops", "reconciliation", name), "utf8");
const expectedHash = "10a1848e33097a9bb79e5cb1f1107a86bac6c724b352a13948665b90559011bb";
const [packet, preflight, postflight, execution, stageC, r2, stageCPreflight, stageCPostflight, stageCRollback] = await Promise.all([
  read("operational-guardrails-r6-production-rollout.md"),
  read("operational-guardrails-r6-production-preflight.sql"),
  read("operational-guardrails-r6-production-postflight.sql"),
  read("operational-guardrails-r6-production-rpc-execution.sql"),
  read("operational-guardrails-r7-stage-c-policy-cleanup.sql"),
  read("operational-guardrails-rate-limit-r2-unexecuted-proposal.sql"),
  read("operational-guardrails-r7-stage-c-preflight.sql"),
  read("operational-guardrails-r7-stage-c-postflight.sql"),
  read("operational-guardrails-r7-stage-c-rollback.sql"),
]);
assert.equal(createHash("sha256").update(r2).digest("hex"), expectedHash, "R6 must bind the reviewed R2 proposal exactly");
for (const checkpoint of Array.from({ length: 13 }, (_, index) => `R6-${index}`)) assert.match(packet, new RegExp(`\\b${checkpoint}\\b`));
for (const marker of ["APPROVE_R6_PRODUCTION_STAGED_EXECUTION_WITH_LOCAL_STAGING_ONLY_RISK_ACCEPTANCE", "R5_PREVIEW_BLOCKED_TARGET_IDENTITY", "BINDING_ABSENT_PRODUCTION_BLOCKED", "APPROVE_R7_PRODUCTION_STAGE_C_REDUNDANT_POLICY_CLEANUP_STAGED_EXECUTION"]) assert.match(packet, new RegExp(marker));
for (const sql of [preflight, postflight]) {
  const executable = sql.split(/\r?\n/).filter((line) => !line.trimStart().startsWith("--")).join("\n").trim();
  const withoutLiterals = executable.replace(/'(?:''|[^'])*'/g, "");
  assert.match(executable, /^WITH\s+/i);
  assert.equal((executable.match(/;/g) ?? []).length, 1, "R6 packet must have one top-level statement");
  assert.match(executable, /ORDER BY section_order, check_order;/);
  assert.doesNotMatch(withoutLiterals, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/i);
}
assert.match(preflight, /forum_upload_attempts/);
assert.match(preflight, /consume_forum_rate_limit/);
assert.match(preflight, /consume_verification_email_resend_limit\(text,integer,integer\)/);
assert.match(postflight, /consume_verification_email_resend_limit\(text,integer,integer\)/);
assert.doesNotMatch(preflight, /consume_verification_email_resend'(?!_)/);
assert.doesNotMatch(postflight, /consume_verification_email_resend'(?!_)/);
assert.match(postflight, /service_role/);
assert.match(execution, /ON_ERROR_STOP=1/);
assert.match(execution, /FUNCTION_ABSENT_SAFE_TO_CREATE/);
assert.match(execution, /single-result/);
assert.match(execution, new RegExp(expectedHash));
const executableWrapper = execution.split(/\r?\n/).filter((line) => !line.trimStart().startsWith("--")).join("\n");
assert.doesNotMatch(executableWrapper, /CREATE FUNCTION|DROP POLICY|GRANT|REVOKE/i);
assert.match(stageC, /UNEXECUTED R7 ONLY/);
assert.match(stageC, /DROP POLICY forum_upload_attempts_insert_self/);
assert.match(stageC, /DROP POLICY forum_upload_attempts_select_self/);
assert.doesNotMatch(stageC, /IF EXISTS/i);
for (const sql of [stageCPreflight, stageCPostflight]) assert.match(sql, /BEGIN TRANSACTION READ ONLY[\s\S]*ROLLBACK/);
assert.match(stageCRollback, /CREATE POLICY forum_upload_attempts_insert_self/);
assert.match(stageCRollback, /CREATE POLICY forum_upload_attempts_select_self/);
console.log(JSON.stringify({ status: "PASS", r2ProposalSha256: expectedHash, execution: "operator-gated", stageC: "r7-gated" }));
