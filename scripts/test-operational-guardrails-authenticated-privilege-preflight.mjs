import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const sql = await readFile(path.join(process.cwd(), "docs", "ops", "reconciliation", "operational-guardrails-authenticated-privilege-preflight.sql"), "utf8");
const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();

assert.match(normalized, /^-- .*begin transaction read only;/);
assert.match(normalized, /rollback;$/);
assert.match(sql, /operational-guardrails-authenticated-privilege-preflight-v1/);
assert.match(sql, /'expected_section_count', '8'/);
assert.match(sql, /aclexplode\(/);
assert.match(sql, /has_table_privilege\(/);
assert.match(sql, /pg_policy/);
assert.match(sql, /consume_verification_email_resend_limit/);
assert.match(sql, /has_function_privilege\(/);
assert.match(sql, /grantee = 0 THEN 'PUBLIC'/);
assert.doesNotMatch(normalized, /\b(create|alter|drop|grant|revoke)\b/);
assert.doesNotMatch(normalized, /\b(insert\s+into|update\s+public\.|delete\s+from|truncate\s+table)\b/);
assert.doesNotMatch(normalized, /from\s+public\.forum_upload_attempts\b/);

console.log("operational-guardrails authenticated privilege preflight static contract: PASS");
