import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const sql = await readFile(path.join(process.cwd(), "docs", "ops", "reconciliation", "operational-guardrails-authenticated-privilege-supplemental-preflight.sql"), "utf8");
const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();

assert.match(normalized, /^-- .*begin transaction read only;/);
assert.match(normalized, /rollback;$/);
assert.match(sql, /operational-guardrails-authenticated-privilege-supplemental-preflight-v1/);
assert.match(sql, /'expected_section_count', '8'/);
assert.match(normalized, /with recursive/);
assert.match(sql, /pg_auth_members/);
assert.match(sql, /has_schema_privilege\(/);
assert.match(sql, /has_sequence_privilege\(/);
assert.match(sql, /pg_attrdef/);
assert.match(sql, /pg_depend/);
assert.match(sql, /grantee = 0 THEN 'PUBLIC'/);
assert.doesNotMatch(normalized, /\b(create\s+(?:table|index|function|policy|schema|sequence)|alter\s+(?:table|function|schema)|drop\s+(?:table|index|function|policy|schema|sequence)|grant\s+.+\s+to|revoke\s+.+\s+from)\b/);
assert.doesNotMatch(normalized, /\b(insert\s+into|update\s+public\.|delete\s+from|truncate\s+table)\b/);
assert.doesNotMatch(normalized, /from\s+public\.forum_upload_attempts\b/);

console.log("operational-guardrails authenticated privilege supplemental preflight static contract: PASS");
