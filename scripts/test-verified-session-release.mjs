import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(path.join(root, name), "utf8");
const includesAll = (text, values, label) => {
  for (const value of values) assert.ok(text.includes(value), `${label}: missing ${value}`);
};

const pkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));
assert.equal(pkg.dependencies["@supabase/supabase-js"], "^2.110.0");
assert.equal(pkg.devDependencies.supabase, "2.115.0");
assert.equal(lock.packages["node_modules/@supabase/supabase-js"].version, "2.112.4");
assert.equal(lock.packages["node_modules/@supabase/auth-js"].version, "2.112.4");
assert.equal(lock.packages["node_modules/supabase"].version, "2.115.0");

const migration = read("supabase/migrations/20260923000000_ogh_verified_session_v1.sql");
const tables = ["ogh_verified_sessions", "ogh_login_challenges", "ogh_email_send_budget", "ogh_policy_acceptances"];
const functions = [
  "ogh_is_verified_session()",
  "ogh_reserve_login_challenge(p_user_id uuid, p_session_id uuid, p_challenge_id uuid, p_digest bytea, p_ip_hash text, p_resend boolean)",
  "ogh_finalize_login_delivery(p_user_id uuid, p_session_id uuid, p_challenge_id uuid, p_accepted boolean)",
  "ogh_consume_login_challenge(p_user_id uuid, p_session_id uuid, p_challenge_id uuid, p_digest bytea)",
  "ogh_activate_signup_session(p_user_id uuid, p_session_id uuid)",
  "ogh_revoke_verified_session(p_user_id uuid, p_session_id uuid)",
  "ogh_record_policy_acceptance(p_user_id uuid, p_bundle text, p_terms text, p_privacy text, p_guidelines text, p_source text)",
  "ogh_has_current_policy_acceptance(p_bundle text, p_terms text, p_privacy text, p_guidelines text)",
];
const normalized = (value) => value.replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim().toLowerCase();
const actualTables = [...migration.matchAll(/create table\s+private\.(\w+)\s*\(/gi)].map((match) => match[1]);
assert.deepEqual(actualTables.sort(), tables.toSorted(), "exactly four private v1 tables");
const actualFunctions = [...migration.matchAll(/create function\s+public\.(ogh_\w+)\s*\(([^)]*)\)/gi)]
  .map((match) => normalized(`${match[1]}(${match[2]})`));
assert.deepEqual(actualFunctions.sort(), functions.map(normalized).sort(), "exactly eight v1 function signatures");

const packet = read("docs/ops/verified-session-v1-release-gates.md");
includesAll(packet, [
  "NON-EXECUTABLE", "NO_GO", "separate authorization", "no default-open fallback",
  "Backward-compatible code ready", "DB security layer", "Worker/API enforcement activation",
  "Bounded auth verification", "Release closeout", "Rollback", "Evidence record",
  "getClaims", "JWKS", "session_id", "amr", 'type:"signup"', "{{ .Token }}",
  "Brevo Free", "shared", "sender", "API key", "Terms", "Privacy", "Guidelines",
  "effective Production ACL", "local/preview", "Realtime", "caller-controlled resend-hash",
  "one-second", "risk decision", "fail closed", "no 16+ auth gate",
], "release packet gate");
includesAll(packet, tables.map((name) => `private.${name}`), "private table ledger");
includesAll(packet, functions.map((name) => `public.${name}`), "function ledger");
includesAll(packet, [
  "/api/auth/session-state", "/api/auth/login-challenge/start", "/api/auth/login-challenge/resend",
  "/api/auth/login-challenge/verify", "/api/auth/signup-confirm", "/api/auth/logout",
  "/api/auth/resend-confirmation", "/api/legal/consent", "/api/users/me/",
  "/api/forum/", "/api/admin/", "/api/media/", "/api/news",
  "legal-consent-repository.server.ts", "consume-forum-rate-limit.server.ts",
  "moderation-notifications.server.ts", "supabase-admin-client.server.ts",
  "admin-circle-purge.server.ts", "supabase-admin.server.ts",
  "post-media", "profile-media", "news-media", "forum_notifications",
  "comments", "post_votes", "comment_reactions",
], "route and service surface ledger");
includesAll(packet, [
  "profiles", "circles", "posts", "comments", "reports", "report_events",
  "moderation_actions", "post_votes", "bookmarks", "comment_reactions", "post_media",
  "forum_upload_attempts", "forum_notifications", "user_safety_states", "user_safety_events",
  "legal_policy_acceptances", "news_articles", "devices", "device_spec_definitions",
  "device_specs", "device_sources", "device_source_links", "device_spec_evidence",
  "catalog_audit_events", "record_current_legal_policy_acceptance",
  "consume_verification_email_resend_limit", "increment_post_view_count",
  "increment_news_article_view", "storage.objects",
], "policy surface ledger");
assert.doesNotMatch(packet, /^\s*(?:\$|>|PS>)?\s*(?:npm run qa:prod|npx wrangler deploy|wrangler deploy|supabase db push|supabase migration up|psql\b)/im,
  "packet must not contain an executable Production/release step");
assert.doesNotMatch(packet, /(?:paid tier|plan upgrade|auto(?:matic)? fallback to single.factor)/i,
  "packet must not require paid service or default-open fallback");

console.log("PASS verified-session release packet: locked versions, four tables, eight signatures, review gates and surface ledger");
