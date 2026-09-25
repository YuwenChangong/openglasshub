import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, "supabase/migrations");
const foundation = "20260923000000_ogh_verified_session_v1_foundation.sql";
const enforcement = "20260925012231_ogh_verified_session_v1_enforcement.sql";
const obsolete = [
  "20260923000000_ogh_verified_session_v1.sql",
  "20260925012231_lock_verification_email_resend_limit.sql",
];

for (const name of [foundation, enforcement]) {
  assert.ok(existsSync(path.join(directory, name)), `NEW_MIGRATION_PAIR_MISSING: ${name}`);
}
for (const name of obsolete) {
  assert.ok(!existsSync(path.join(directory, name)), `OLD_MIGRATION_STILL_PRESENT: ${name}`);
}

const v1 = readdirSync(directory).filter((name) =>
  /_ogh_verified_session_v1(?:_|\.)|_lock_verification_email_resend_limit\.sql$/.test(name));
assert.deepEqual(v1.sort(), [foundation, enforcement].sort(), "V1_MIGRATION_ARTIFACT_COUNT");

const first = readFileSync(path.join(directory, foundation), "utf8");
const second = readFileSync(path.join(directory, enforcement), "utf8");
assert.doesNotMatch(first, /create\s+policy\s+ogh_verified_/i, "FOUNDATION_HAS_FINAL_POLICY");
assert.doesNotMatch(first, /create\s+policy\s+ogh_verified_storage_/i, "FOUNDATION_HAS_STORAGE_ENFORCEMENT");
assert.doesNotMatch(second, /create\s+table\s+private\.ogh_/i, "ENFORCEMENT_RECREATES_TABLE");
assert.doesNotMatch(second, /create\s+function\s+public\.ogh_/i, "ENFORCEMENT_RECREATES_FUNCTION");
assert.doesNotMatch(second, /create\s+or\s+replace\s+function\s+public\.consume_verification_email_resend_limit/i,
  "ENFORCEMENT_RECREATES_RESEND_BODY");
assert.match(first, /create\s+or\s+replace\s+function\s+public\.consume_verification_email_resend_limit/i,
  "FOUNDATION_RESEND_BODY_MISSING");
assert.match(second, /revoke\s+all\s+on\s+function\s+public\.consume_verification_email_resend_limit/i,
  "ENFORCEMENT_RESEND_ACL_MISSING");

console.log("PASS verified-session migration shape: exactly Foundation and Enforcement");
