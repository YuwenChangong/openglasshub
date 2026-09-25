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
const assertMigrationTables = (source) => {
  const actualTables = [...source.matchAll(/create table\s+(?:if\s+not\s+exists\s+)?private\.(\w+)\s*\(/gi)].map((match) => match[1]);
  assert.deepEqual(actualTables.sort(), tables.toSorted(), "exactly four private v1 tables");
};
assertMigrationTables(migration);
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
const section = (source, heading) => {
  source = source.replace(/\r\n/g, "\n");
  const marker = `## ${heading}\n`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing section: ${heading}`);
  const rest = source.slice(start + marker.length);
  return rest.split(/^## /m, 1)[0];
};
const assertPacketLedger = (source) => {
  const rows = new Map([...section(source, "Authorization surface ledger").matchAll(/^\| ([^|]+) \| (.+) \|$/gm)]
    .map((match) => [match[1].trim(), match[2]]));
  const required = {
    "Auth routes": ["/api/auth/session-state", "/api/auth/login-challenge/start", "/api/auth/login-challenge/resend", "/api/auth/login-challenge/verify", "/api/auth/signup-confirm", "/api/auth/logout", "/api/auth/resend-confirmation", "Pending"],
    "Legal route": ["/api/legal/consent", "pending", "Terms", "Privacy", "Guidelines"],
    "Protected routes": ["/api/users/me/", "summary/profile/notifications", "/api/forum/", "post-media/media-upload-guard/external-video-upload", "/api/forum/circles/[slug]/", "/api/admin/", "approve/hide/reject/queue/lexicon-health", "ban/unban/suspend/warn/clear-warning/safety", "trusted-runtime", "before", "role"],
    "Public and media routes": ["/api/news", "/api/media/", "products/feed/circles/search", "anonymous", "private media"],
    "Service-role paths": ["legal-consent-repository.server.ts", "consume-forum-rate-limit.server.ts", "moderation-notifications.server.ts", "supabase-admin-client.server.ts", "admin-circle-purge.server.ts", "supabase-admin.server.ts", "zero privileged downstream calls"],
    "RLS tables": ["profiles", "circles", "posts", "comments", "reports", "report_events", "moderation_actions", "post_votes", "bookmarks", "comment_reactions", "post_media", "forum_upload_attempts", "forum_notifications", "user_safety_states", "user_safety_events", "legal_policy_acceptances", "news_articles", "devices", "device_spec_definitions", "device_specs", "device_sources", "device_source_links", "device_spec_evidence", "catalog_audit_events", "deny pending", "public SELECT"],
    "Direct RPC": ["EXECUTE", "record_current_legal_policy_acceptance", "consume_verification_email_resend_limit", "increment_post_view_count", "increment_news_article_view", "ordinary mutators deny pending"],
    Storage: ["storage.objects", "post-media", "profile-media", "news-media", "pending INSERT/UPDATE/DELETE", "private SELECT", "public media SELECT"],
    Realtime: ["forum_notifications", "comments", "post_votes", "comment_reactions", "pending private notifications deny", "verified positive delivery"],
  };
  assert.deepEqual([...rows.keys()].filter((key) => key !== "Surface" && key !== "---").sort(), Object.keys(required).sort(), "exact authorization ledger rows");
  for (const [name, terms] of Object.entries(required)) includesAll(rows.get(name) ?? "", terms, `ledger ${name}`);
};
assertPacketLedger(packet);
const assertStopGates = (source) => {
  const stagedText = section(source, "Future staged gates");
  const headings = [...stagedText.matchAll(/^### (\d)\. ([^\n]+)$/gm)];
  assert.deepEqual(headings.map((stage) => stage[2]), ["Backward-compatible code ready", "DB security layer", "Worker/API enforcement activation", "Bounded auth verification", "Release closeout"]);
  for (const [index, stage] of headings.entries()) {
    const number = stage[1];
    const title = stage[2];
    const body = stagedText.slice(stage.index + stage[0].length, headings[index + 1]?.index);
    assert.match(body, /separat(?:e|ely)/i, `stage ${number} ${title}: separate authorization`);
    assert.match(body, /\bstop\b|\bstops\b|NO_GO/i, `stage ${number} ${title}: explicit stop`);
  }
};
assertStopGates(packet);
const assertLocalPreviewGate = (source) => {
  const local = section(source, "Hosted prerequisites and local/preview matrix");
  const start = local.indexOf("- **Local/preview schema gate:**");
  assert.ok(start >= 0, "missing local/preview schema gate");
  const next = local.indexOf("\n- ", start + 2);
  const gate = local.slice(start, next < 0 ? undefined : next);
  includesAll(gate, ["all four", "all eight", "exact ACLs", "PASS/FAIL", "evidence", "Before activation", "stop"], "local/preview schema gate");
  includesAll(gate, tables.map((name) => `private.${name}`), "local/preview four tables");
  includesAll(gate, functions.map((name) => `public.${name}`), "local/preview eight functions");
};
assertLocalPreviewGate(packet);
const assertNoReleaseCommands = (source) => {
  for (const line of source.split(/\r?\n/)) {
    assert.doesNotMatch(line, /\b(?:npm\s+run\s+(?:qa:prod|qa:release|deploy[\w:-]*)|(?:(?:npx|bunx|pnpm(?:\s+exec)?|yarn(?:\s+exec)?|npm\s+exec)\s+)?wrangler\s+(?:pages\s+)?deploy|supabase\s+(?:db\s+push|migration\s+up)|psql\b)/i,
      `packet must not contain an executable Production/release step: ${line.slice(0, 80)}`);
  }
};
assertNoReleaseCommands(packet);
assert.doesNotMatch(packet, /(?:paid tier|plan upgrade|auto(?:matic)? fallback to single.factor)/i,
  "packet must not require paid service or default-open fallback");

const mutations = [
  ["fifth table with IF NOT EXISTS", () => assertMigrationTables(`${migration}\nCREATE TABLE IF NOT EXISTS private.ogh_signup_intents (id uuid);`)],
  ["bulleted qa:prod", () => assertNoReleaseCommands(`${packet}\n- Run npm run qa:prod`)],
  ["numbered deploy", () => assertNoReleaseCommands(`${packet}\n1. Deploy with npx wrangler deploy`)],
  ["bullet deploy variant", () => assertNoReleaseCommands(`${packet}\n* Run npm run deploy:prod`)],
  ["numbered pages deploy", () => assertNoReleaseCommands(`${packet}\n2. Run pnpm exec wrangler pages deploy`)],
  ["missing RLS ledger row", () => assertPacketLedger(packet.replace(/^\| RLS tables \|.*$/m, "| RLS tables | omitted |"))],
  ["RLS item moved outside ledger", () => assertPacketLedger(packet.replace(/^(\| RLS tables \|.*?)post_votes/m, "$1omitted") + "\npost_votes")],
  ["auth route moved outside ledger", () => assertPacketLedger(packet.replace(/^(\| Auth routes \|.*?)\/api\/auth\/login-challenge\/verify/m, "$1/omitted") + "\n/api/auth/login-challenge/verify")],
  ["missing DB stop gate", () => assertStopGates(packet.replace(/Failure or an unknown effective grant stops the sequence; never relax the gate to proceed\./, ""))],
  ["missing Worker stop gate", () => assertStopGates(packet.replace(/Any pending bypass or incomplete guard evidence is a stop and keeps status NO_GO\./, ""))],
  ["missing local/preview schema gate", () => assertLocalPreviewGate(packet.replace("- **Local/preview schema gate:**", "- **Schema notes:**"))],
  ["local/preview table absent", () => assertLocalPreviewGate(packet.replace(/(\*\*Local\/preview schema gate:\*\*[\s\S]*?)private\.ogh_verified_sessions/, "$1private.omitted"))],
  ["local/preview function absent", () => assertLocalPreviewGate(packet.replace(/(\*\*Local\/preview schema gate:\*\*[\s\S]*?)public\.ogh_is_verified_session\(\)/, "$1public.omitted()"))],
  ["local/preview exact ACL proof absent", () => assertLocalPreviewGate(packet.replace("exist with exact ACLs", "exist with ACLs"))],
];
const escaped = [];
for (const [name, mutation] of mutations) {
  try { mutation(); escaped.push(name); } catch (error) { if (!(error instanceof assert.AssertionError)) throw error; }
}
assert.deepEqual(escaped, [], `mutations escaped release checks: ${escaped.join(", ")}`);

console.log("PASS verified-session release packet: locked versions, four tables, eight signatures, review gates and surface ledger");
