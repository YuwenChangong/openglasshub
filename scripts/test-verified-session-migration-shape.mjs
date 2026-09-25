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
const expectedTables = ["ogh_verified_sessions", "ogh_login_challenges", "ogh_email_send_budget", "ogh_policy_acceptances"];
const expectedFunctions = [
  "ogh_is_verified_session", "ogh_reserve_login_challenge", "ogh_finalize_login_delivery",
  "ogh_consume_login_challenge", "ogh_activate_signup_session", "ogh_revoke_verified_session",
  "ogh_record_policy_acceptance", "ogh_has_current_policy_acceptance",
];
const mutationTables = [
  "profiles", "circles", "posts", "comments", "reports", "report_events", "moderation_actions",
  "post_votes", "bookmarks", "comment_reactions", "post_media", "forum_upload_attempts",
  "forum_notifications", "user_safety_states", "user_safety_events", "legal_policy_acceptances",
  "news_articles", "devices", "device_spec_definitions", "device_specs", "device_sources",
  "device_source_links", "device_spec_evidence", "catalog_audit_events",
];
const mixedReads = ["circles", "posts", "comments", "post_media", "news_articles", "devices"];
const privateReads = [
  "reports", "report_events", "moderation_actions", "bookmarks", "forum_upload_attempts",
  "forum_notifications", "user_safety_states", "user_safety_events", "device_spec_definitions",
  "device_specs", "device_sources", "device_source_links", "device_spec_evidence", "catalog_audit_events",
];
const names = (source, regex) => [...source.matchAll(regex)].map((match) => match[1]).sort();
const arrayNames = (source) => names(source, /'([a-z_]+)'/g);

function validateShape(foundationSource, enforcementSource) {
  assert.deepEqual(names(foundationSource, /create\s+table\s+private\.(ogh_\w+)/gi), expectedTables.slice().sort(),
    "FOUNDATION_TABLE_MANIFEST");
  assert.deepEqual(names(foundationSource, /create\s+(?:or\s+replace\s+)?function\s+public\.(ogh_\w+)/gi),
    expectedFunctions.slice().sort(), "FOUNDATION_FUNCTION_MANIFEST");
  assert.doesNotMatch(foundationSource, /create\s+policy\s+ogh_verified_/i, "FOUNDATION_HAS_FINAL_POLICY");
  assert.doesNotMatch(foundationSource, /\b(?:alter\s+schema\s+private|revoke\s+\w+\s+on\s+schema\s+private)\b/i,
    "FOUNDATION_BROAD_SCHEMA_CHANGE");
  assert.doesNotMatch(enforcementSource, /create\s+table\s+private\.ogh_/i, "ENFORCEMENT_RECREATES_TABLE");
  assert.doesNotMatch(enforcementSource, /create\s+(?:or\s+replace\s+)?function\s+public\./i,
    "ENFORCEMENT_RECREATES_FUNCTION");

  const arrays = [...enforcementSource.matchAll(/foreach\s+target\s+in\s+array\s+array\[([\s\S]*?)\]/gi)];
  assert.equal(arrays.length, 2, "ENFORCEMENT_POLICY_ARRAYS");
  assert.deepEqual(arrayNames(arrays[0][1]), mutationTables.slice().sort(), "ENFORCEMENT_MUTATION_MANIFEST");
  assert.deepEqual(arrayNames(arrays[1][1]), privateReads.slice().sort(), "ENFORCEMENT_PRIVATE_READ_MANIFEST");
  assert.deepEqual(names(enforcementSource, /create\s+policy\s+ogh_verified_select\s+on\s+public\.(\w+)/gi),
    mixedReads.slice().sort(), "ENFORCEMENT_MIXED_READ_MANIFEST");
  assert.deepEqual(names(enforcementSource, /create\s+policy\s+ogh_verified_storage_(\w+)\s+on\s+storage\.objects/gi),
    ["insert", "update", "delete", "select"].sort(), "ENFORCEMENT_STORAGE_MANIFEST");
  for (const action of ["insert", "update", "delete"]) {
    assert.match(enforcementSource, new RegExp(`create policy ogh_verified_${action} on public\\.%I as restrictive`, "i"),
      `ENFORCEMENT_${action.toUpperCase()}_MISSING`);
  }
  assert.match(foundationSource, /create\s+or\s+replace\s+function\s+public\.consume_verification_email_resend_limit/i,
    "FOUNDATION_RESEND_BODY_MISSING");
  assert.match(foundationSource, /grant\s+execute\s+on\s+function\s+public\.consume_verification_email_resend_limit\([^;]+?\)\s+to\s+anon,\s*authenticated,\s*service_role\s*;/i,
    "FOUNDATION_RESEND_DUAL_GRANT");
  assert.match(enforcementSource, /revoke\s+all\s+on\s+function\s+public\.consume_verification_email_resend_limit\([^;]+?\)\s+from\s+public,\s*anon,\s*authenticated,\s*service_role\s*;/i,
    "ENFORCEMENT_RESEND_REVOKE");
  assert.match(enforcementSource, /grant\s+execute\s+on\s+function\s+public\.consume_verification_email_resend_limit\([^;]+?\)\s+to\s+service_role\s*;/i,
    "ENFORCEMENT_RESEND_SERVICE_ONLY");
}

validateShape(first, second);
assert.throws(() => validateShape(first.replace("create table private.ogh_policy_acceptances", "create table private.missing_policy_acceptances"), second),
  /FOUNDATION_TABLE_MANIFEST/);
assert.throws(() => validateShape(first, second.replace("'catalog_audit_events'", "'unlisted_table'")),
  /ENFORCEMENT_MUTATION_MANIFEST/);
assert.throws(() => validateShape(`${first}\ncreate policy ogh_verified_insert on public.posts`, second),
  /FOUNDATION_HAS_FINAL_POLICY/);

console.log("PASS verified-session migration shape: exactly Foundation and Enforcement");
