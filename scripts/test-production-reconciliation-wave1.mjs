import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalize } from "./production-schema-fingerprint-core.mjs";

const root = process.cwd();
const packetDirectory = path.join(root, "docs", "ops", "reconciliation");
const preflight = await readFile(path.join(packetDirectory, "legal-consent-production-wave1-preflight.sql"), "utf8");
const proposal = await readFile(path.join(packetDirectory, "legal-consent-production-wave1-proposal.sql"), "utf8");
const postflight = await readFile(path.join(packetDirectory, "legal-consent-production-wave1-postflight.sql"), "utf8");
const checklist = await readFile(path.join(root, "docs", "ops", "reconciliation", "legal-consent-production-wave1-execution-checklist.md"), "utf8");
const forwardPlan = await readFile(path.join(root, "docs", "ops", "legal-consent-production-forward-reconciliation-plan.md"), "utf8");
const manifest = JSON.parse(await readFile(path.join(root, "tests", "fixtures", "production-schema-forward-reconciliation.json"), "utf8"));
const expected = JSON.parse(await readFile(path.join(root, "tests", "fixtures", "production-schema-expected-fingerprint.json"), "utf8"));

const notificationSignature = "public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid)";
const viewSignature = "public.increment_post_view_count(uuid)";
const targetIdentities = ["increment_post_view_count(uuid)", "insert_forum_notification(uuid,uuid,text,uuid,uuid,uuid)"];
const targetFunctionNames = ["increment_post_view_count", "insert_forum_notification"];
const withoutComments = (sql) => sql.replace(/--[^\n]*/g, "");
const hash = (value) => createHash("sha256").update(normalize(value)).digest("hex");

for (const [name, sql] of [["preflight", preflight], ["postflight", postflight]]) {
  const executable = withoutComments(sql);
  assert.match(executable, /^\s*BEGIN TRANSACTION READ ONLY;/, `${name} must begin read-only`);
  assert.match(executable, /\nROLLBACK;\s*$/, `${name} must roll back`);
  assert.doesNotMatch(executable, /^\s*(?:CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DO|CALL|EXECUTE)\b/im, `${name} must remain read-only`);
  assert.match(sql, /pg_get_functiondef/, `${name} must export exact definitions`);
  assert.match(sql, /normalized_function_body_hash/, `${name} must export normalized body hashes`);
  assert.match(sql, /aclexplode/, `${name} must export explicit ACLs`);
  for (const target of targetFunctionNames) assert.match(sql, new RegExp(target), `${name} must scope ${target}`);
}

for (const marker of ["UNEXECUTED", "PRODUCTION_REVIEW_PROPOSAL", "DO NOT RUN WITHOUT FRESH PREFLIGHT", "REQUIRES DATABASE/SECURITY REVIEW", "REQUIRES EXPLICIT HUMAN PRODUCTION APPROVAL", "NOT A CANONICAL MIGRATION", "NOT MIGRATION-HISTORY REPAIR"]) {
  assert.match(proposal, new RegExp(marker));
}
assert.equal((proposal.match(/CREATE OR REPLACE FUNCTION public\.increment_post_view_count/g) ?? []).length, 1, "only the reviewed post-view body may be replaced");
assert.doesNotMatch(proposal, /CREATE OR REPLACE FUNCTION public\.insert_forum_notification/, "notification body must not be replaced");
assert.match(proposal, /moderation_status = 'published'/);
assert.match(proposal, /public\.can_access_public_circle\(post_ref\.circle_id\)/);
for (const signature of [notificationSignature, viewSignature]) assert.match(proposal, new RegExp(signature.replace(/[()]/g, "\\$&").replace(/, /g, ",\\s*")));
assert.doesNotMatch(proposal, /GRANT\s+ALL|GRANT\s+EXECUTE\s+ON\s+FUNCTION[^;]+\s+TO\s+PUBLIC/i);
assert.doesNotMatch(proposal, /schema_migrations|migration repair|db push/i);
assert.doesNotMatch(proposal, /(?:can_create_user_report_target|legal_policy_acceptances|post_media|circle_cover)/i, "no Wave 2+ object may appear");
assert.match(proposal, /REVOKE ALL ON FUNCTION public\.increment_post_view_count\(uuid\) FROM PUBLIC, anon, authenticated, service_role;/);
assert.match(proposal, /GRANT EXECUTE ON FUNCTION public\.increment_post_view_count\(uuid\) TO anon, authenticated;/);
assert.match(proposal, /REVOKE ALL ON FUNCTION public\.insert_forum_notification\(uuid, uuid, text, uuid, uuid, uuid\) FROM PUBLIC, anon, authenticated, service_role;/);
assert.match(proposal, /GRANT EXECUTE ON FUNCTION public\.insert_forum_notification\(uuid, uuid, text, uuid, uuid, uuid\) TO service_role;/);
assert.match(proposal, /DO \$assertions\$/);

for (const gate of ["Gate A", "Gate B", "Gate C", "Gate D"]) assert.match(checklist, new RegExp(gate));
assert.match(checklist, /do not restore\s+PUBLIC EXECUTE/i);
assert.match(checklist, /secure forward-fix/i);
assert.match(forwardPlan, /BLOCKED_PENDING_CIRCLE_ACCESS_PREREQUISITE_PREFLIGHT/);

const waveOne = manifest.items.filter((item) => item.proposedWave === "W1_ACL_FUNCTION_HARDENING");
assert.deepEqual([...new Set(waveOne.map((item) => item.identity))].sort(), targetIdentities);
for (const item of waveOne) {
  assert.equal(item.blockerStatus, "BLOCKED_PENDING_NON_PRODUCTION_APPROVAL");
}
assert.deepEqual(manifest.wave1ExecutionPacket, {
  status: "BLOCKED_PENDING_CIRCLE_ACCESS_PREREQUISITE_PREFLIGHT",
  exactSignatures: [viewSignature, notificationSignature],
  proposalStatus: "PROPOSAL_AUTHORED_LOCAL_VALIDATED_UNEXECUTED",
  proposalFile: "docs/ops/reconciliation/legal-consent-production-wave1-proposal.sql",
  preflightFile: "docs/ops/reconciliation/legal-consent-production-wave1-preflight.sql",
  postflightFile: "docs/ops/reconciliation/legal-consent-production-wave1-postflight.sql",
  executionChecklistFile: "docs/ops/reconciliation/legal-consent-production-wave1-execution-checklist.md",
  prerequisite: {
    identity: "public.can_access_public_circle(uuid)",
    status: "ADDITIONAL_PREFLIGHT_REQUIRED",
    preflightFile: "docs/ops/reconciliation/can-access-public-circle-preflight.sql",
    proposalAuthored: false,
    postflightAuthored: false,
  },
  realProductionOperations: 0,
});

const expectedView = expected.objects.find((entry) => entry.identity === "increment_post_view_count(uuid)" && entry.attribute === "definition");
const expectedNotification = expected.objects.find((entry) => entry.identity === "insert_forum_notification(uuid,uuid,text,uuid,uuid,uuid)" && entry.attribute === "definition");
assert(expectedView && expectedNotification, "both exact expected function contracts are required");

const changedMigrations = execFileSync("git", ["diff", "--name-only", "HEAD", "--", "supabase/migrations"], { cwd: root, encoding: "utf8" }).trim();
const changedRuntime = execFileSync("git", ["diff", "--name-only", "HEAD", "--", "src"], { cwd: root, encoding: "utf8" }).trim();
assert.equal(changedMigrations, "", "canonical migrations must remain unchanged");
assert.equal(changedRuntime, "", "runtime application files must remain unchanged");

const containers = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter((name) => name.startsWith("supabase_db_local-supabase-normalized-replay-"));
assert.equal(containers.length, 1, "LOCAL_DOCKER_ONLY requires one disposable normalized replay database container");
const container = containers[0];
const psql = (sql) => execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { input: sql, encoding: "utf8" }).trim();
const contract = (signature) => psql(`SELECT 'returns=' || pg_get_function_result(p.oid) || ';security_definer=' || CASE WHEN p.prosecdef THEN 'true' ELSE 'false' END || ';owner=' || pg_get_userbyid(p.proowner) || ';search_path=' || coalesce(array_to_string(p.proconfig, ', '), '') || ';body=' || pg_get_functiondef(p.oid) FROM pg_proc p WHERE p.oid = '${signature}'::regprocedure;`);
assert.equal(hash(contract(viewSignature)), expectedView.deterministicSha256, "local view-count baseline must match the verified expected contract");
assert.equal(hash(contract(notificationSignature)), expectedNotification.deterministicSha256, "local notification baseline must match the verified expected contract");

const operations = proposal.replace(/^\s*BEGIN;\s*/m, "").replace(/\s*COMMIT;\s*$/, "");
const postflightOperations = postflight.replace(/^\s*BEGIN TRANSACTION READ ONLY;\s*/m, "").replace(/\s*ROLLBACK;\s*$/, "");
const observedViewBody = `
CREATE OR REPLACE FUNCTION public.increment_post_view_count(p_post_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  update public.posts set view_count = coalesce(view_count, 0) + 1
  where id = p_post_id and status = 'published';
$function$;`;
const simulation = psql(`
BEGIN;
${observedViewBody}
ALTER FUNCTION ${viewSignature} OWNER TO postgres;
ALTER FUNCTION ${viewSignature} SECURITY DEFINER;
ALTER FUNCTION ${viewSignature} SET search_path TO public;
REVOKE ALL ON FUNCTION ${viewSignature} FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION ${viewSignature} TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ${notificationSignature} FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION ${notificationSignature} TO PUBLIC, anon, authenticated;
SELECT 'START|' || md5(regexp_replace(trim((SELECT prosrc FROM pg_proc WHERE oid = '${viewSignature}'::regprocedure)), E'\\s+', ' ', 'g')) || '|' || coalesce((SELECT bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl WHERE p.oid = '${viewSignature}'::regprocedure), false) || '|' || has_function_privilege('service_role', '${notificationSignature}', 'EXECUTE');
${operations}
${postflightOperations}
SELECT 'CONVERGED|' || encode(convert_to('returns=' || pg_get_function_result(p.oid) || ';security_definer=' || CASE WHEN p.prosecdef THEN 'true' ELSE 'false' END || ';owner=' || pg_get_userbyid(p.proowner) || ';search_path=' || coalesce(array_to_string(p.proconfig, ', '), '') || ';body=' || pg_get_functiondef(p.oid), 'UTF8'), 'hex') || '|' || coalesce((SELECT bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl), false) || '|' || has_function_privilege('anon', p.oid, 'EXECUTE') || '|' || has_function_privilege('authenticated', p.oid, 'EXECUTE') || '|' || has_function_privilege('service_role', p.oid, 'EXECUTE') FROM pg_proc p WHERE p.oid = '${viewSignature}'::regprocedure;
SELECT 'NOTIFICATION|' || encode(convert_to('returns=' || pg_get_function_result(p.oid) || ';security_definer=' || CASE WHEN p.prosecdef THEN 'true' ELSE 'false' END || ';owner=' || pg_get_userbyid(p.proowner) || ';search_path=' || coalesce(array_to_string(p.proconfig, ', '), '') || ';body=' || pg_get_functiondef(p.oid), 'UTF8'), 'hex') || '|' || coalesce((SELECT bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl), false) || '|' || has_function_privilege('anon', p.oid, 'EXECUTE') || '|' || has_function_privilege('authenticated', p.oid, 'EXECUTE') || '|' || has_function_privilege('service_role', p.oid, 'EXECUTE') FROM pg_proc p WHERE p.oid = '${notificationSignature}'::regprocedure;
ROLLBACK;
`);
const line = (prefix) => simulation.split(/\r?\n/).find((value) => value.startsWith(prefix));
assert.match(line("START|"), /^START\|[a-f0-9]{32}\|true\|true$/, "combined simulation must reproduce both reviewed drifts");
const [, viewContractHex, viewPublic, viewAnon, viewAuthenticated, viewService] = line("CONVERGED|").split("|");
const [, notificationContractHex, notificationPublic, notificationAnon, notificationAuthenticated, notificationService] = line("NOTIFICATION|").split("|");
assert.equal(hash(Buffer.from(viewContractHex, "hex").toString("utf8")), expectedView.deterministicSha256);
assert.equal(hash(Buffer.from(notificationContractHex, "hex").toString("utf8")), expectedNotification.deterministicSha256);
assert.deepEqual([viewPublic, viewAnon, viewAuthenticated, viewService], ["false", "true", "true", "false"]);
assert.deepEqual([notificationPublic, notificationAnon, notificationAuthenticated, notificationService], ["false", "false", "false", "true"]);

console.log(JSON.stringify({ localDockerOnly: true, exactFunctionScope: 2, combinedDriftReproduced: true, combinedTransactionConverged: true, notificationBodyPreserved: true, viewBodyConverged: true, noRuntimeOrMigrationChanges: true, realProductionOperations: 0 }));
