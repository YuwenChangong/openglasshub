import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalize, parseCsv, validateProductionExport } from "./production-schema-fingerprint-core.mjs";

const root = process.cwd();
const csvPath = "C:/Users/1/Downloads/increment-post-view-count-body.csv";
const signature = "public.increment_post_view_count(uuid)";
const callableName = "public.increment_post_view_count";
const targetIdentity = "increment_post_view_count(uuid)";
const preflight = await readFile(path.join(root, "docs", "ops", "reconciliation", "legal-consent-production-wave1b-preflight.sql"), "utf8");
const proposal = await readFile(path.join(root, "docs", "ops", "reconciliation", "legal-consent-production-wave1b-proposal.sql"), "utf8");
const expected = JSON.parse(await readFile(path.join(root, "tests", "fixtures", "production-schema-expected-fingerprint.json"), "utf8"));

assert(existsSync(csvPath), "the manually exported production function packet is required for Wave 1B forensic validation");
const rows = parseCsv(await readFile(csvPath, "utf8"));
const exportValidation = validateProductionExport(rows);
const targetRows = rows.filter((row) => row.section === "functions" && row.object_type === "function" && row.schema_name === "public" && row.object_name === "increment_post_view_count" && row.identity === targetIdentity && row.attribute === "definition");
assert.equal(targetRows.length, 1, "the packet must contain exactly one target function definition");
const observed = targetRows[0];
const hash = (value) => createHash("sha256").update(normalize(value)).digest("hex");
assert.equal(hash(observed.value), observed.definition_hash, "the exported target definition hash must be internally consistent");
assert.equal(observed.definition_hash, "c29ed210f5aa903e33323aff772130d038f72c42cd6ccae593e33dda5d87b1f2");

const expectedDefinition = expected.objects.find((entry) => entry.objectType === "function" && entry.identity === targetIdentity && entry.attribute === "definition");
assert(expectedDefinition, "the verified local target definition is required");
assert.equal(expectedDefinition.deterministicSha256, "5e5d6c9682a32dbb9deb7003be854eaf06700577593c7b7ac108ddecd55fed5d");
const observedBody = observed.value.split(";body=")[1];
const expectedBody = expectedDefinition.normalizedStructuralDefinition.split(";body=")[1];
assert(observedBody && expectedBody, "function fingerprint rows must include bodies");
const observedExecutable = observedBody.trim().endsWith(";") ? observedBody : `${observedBody};`;
assert.match(observedBody, /^CREATE OR REPLACE FUNCTION public\.increment_post_view_count\(p_post_id uuid\)/);
assert.match(observedBody, /update public\.posts set view_count = coalesce\(view_count, 0\) \+ 1 where id = p_post_id and status = 'published';/i);
assert.doesNotMatch(observedBody, /moderation_status\s*=\s*'published'|can_access_public_circle|execute\s+immediate|format\s*\(/i);
assert.match(expectedBody, /moderation_status = 'published'/i);
assert.match(expectedBody, /public\.can_access_public_circle\(post_ref\.circle_id\)/i);

for (const [attribute, expectedValue, observedValue] of [
  ["PUBLIC_execute", "false", "true"],
  ["anon_execute", "true", "true"],
  ["authenticated_execute", "true", "true"],
  ["service_role_execute", "false", "true"],
]) {
  const expectedAcl = expected.objects.find((entry) => entry.objectType === "function" && entry.identity === targetIdentity && entry.attribute === attribute);
  const observedAcl = rows.find((row) => row.section === "function_acl" && row.object_type === "function" && row.schema_name === "public" && row.identity === targetIdentity && row.attribute === attribute);
  assert.equal(expectedAcl?.normalizedStructuralDefinition, expectedValue, `expected ${attribute} must match the reviewed contract`);
  assert.equal(observedAcl?.value, observedValue, `observed ${attribute} must match the manual export`);
}

const uncommentedPreflight = preflight.replace(/--[^\n]*/g, "");
assert.match(uncommentedPreflight, /^\s*BEGIN TRANSACTION READ ONLY;/);
assert.match(uncommentedPreflight, /\nROLLBACK;\s*$/);
assert.match(preflight, /to_regprocedure\('public\.increment_post_view_count\(uuid\)'\)/);
assert.doesNotMatch(uncommentedPreflight, /^\s*(?:CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DO|CALL|EXECUTE)\b/im);
for (const marker of ["UNEXECUTED", "NON_PRODUCTION_REVIEW_PROPOSAL", "NOT FOR DIRECT PRODUCTION EXECUTION", "REQUIRES FRESH PREFLIGHT OUTPUT AND HUMAN APPROVAL"]) assert.match(proposal, new RegExp(marker));
assert.match(proposal, /CREATE OR REPLACE FUNCTION public\.increment_post_view_count\(p_post_id uuid\)/);
assert.match(proposal, /moderation_status = 'published'/);
assert.match(proposal, /public\.can_access_public_circle\(post_ref\.circle_id\)/);
assert.match(proposal, /REVOKE ALL ON FUNCTION public\.increment_post_view_count\(uuid\) FROM PUBLIC;/);
assert.match(proposal, /REVOKE EXECUTE ON FUNCTION public\.increment_post_view_count\(uuid\) FROM service_role;/);
assert.match(proposal, /GRANT EXECUTE ON FUNCTION public\.increment_post_view_count\(uuid\) TO anon, authenticated;/);
assert.doesNotMatch(proposal, /insert_forum_notification|GRANT\s+(?:ALL|EXECUTE)\s+ON\s+FUNCTION[^;]+\s+TO\s+PUBLIC/i);

const sourceHits = execFileSync("rg", ["-l", "increment_post_view_count", "src"], { cwd: root, encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean).map((file) => file.replace(/\\/g, "/")).sort();
assert.deepEqual(sourceHits, ["src/lib/post-engagement.ts"]);
const detailPage = await readFile(path.join(root, "src", "pages", "posts", "[id].astro"), "utf8");
assert.match(detailPage, /import \{ buildPostLikeCountMap, safeIncrementPostViewCount \} from "\.\.\/\.\.\/lib\/post-engagement";/);
const incrementInvocation = detailPage.indexOf("await safeIncrementPostViewCount");
assert(detailPage.indexOf('.eq("status", "published")') < incrementInvocation);
assert(detailPage.indexOf('.eq("moderation_status", "published")') < incrementInvocation);

const containerNames = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" }).split(/\r?\n/).filter((name) => name.startsWith("supabase_db_local-supabase-normalized-replay-"));
assert.equal(containerNames.length, 1, "LOCAL_DOCKER_ONLY requires one disposable normalized replay database container");
const container = containerNames[0];
const runLocalPsql = (sql) => execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { input: sql, encoding: "utf8" }).trim();
const contractExpression = `'returns=' || pg_get_function_result(p.oid) || ';security_definer=' || CASE WHEN p.prosecdef THEN 'true' ELSE 'false' END || ';owner=' || pg_get_userbyid(p.proowner) || ';search_path=' || coalesce(array_to_string(p.proconfig, ', '), '') || ';body=' || pg_get_functiondef(p.oid)`;
const contractSql = `SELECT ${contractExpression} FROM pg_proc p WHERE p.oid = '${signature}'::regprocedure;`;
assert.match(runLocalPsql(preflight), /increment_post_view_count/);
assert.equal(hash(runLocalPsql(contractSql)), expectedDefinition.deterministicSha256, "the normalized local replay must start at the exact verified target body");

const ids = {
  visible: "00000000-0000-4000-8000-000000000101",
  hidden: "00000000-0000-4000-8000-000000000102",
  deleted: "00000000-0000-4000-8000-000000000103",
  pending: "00000000-0000-4000-8000-000000000104",
  unmoderated: "00000000-0000-4000-8000-000000000105",
  inaccessible: "00000000-0000-4000-8000-000000000106",
  missing: "00000000-0000-4000-8000-000000000107",
};
const allPostIds = Object.values(ids).slice(0, 6);
const proposalOperations = proposal.replace(/\nBEGIN;\s*/, "\n").replace(/\nCOMMIT;\s*$/, "\n");
const calls = (idsToCall) => idsToCall.map((id) => `SELECT ${callableName}('${id}');`).join("\n");
const countLine = (label) => `SELECT '${label}|' || string_agg(id::text || '=' || view_count::text, ',' ORDER BY id) FROM public.posts WHERE id IN (${allPostIds.map((id) => `'${id}'`).join(", ")});`;
const simulation = runLocalPsql(`
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO public.circles (id, slug, name, description, type, status) VALUES
  ('00000000-0000-4000-8000-000000000201', 'wave1b-public', 'Wave 1B Public', 'Local only', 'topic', 'active'),
  ('00000000-0000-4000-8000-000000000202', 'rls-test-circle', 'RLS Test Circle', 'Local only', 'topic', 'active');
INSERT INTO public.profiles (id, display_name, role) VALUES
  ('00000000-0000-4000-8000-000000000301', 'Wave 1B Local Author', 'user');
INSERT INTO public.posts (id, author_id, circle_id, type, title, body, status, moderation_status, view_count) VALUES
  ('${ids.visible}', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000201', 'question', 'Visible', 'Local only', 'published', 'published', 0),
  ('${ids.hidden}', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000201', 'question', 'Hidden', 'Local only', 'hidden', 'published', 0),
  ('${ids.deleted}', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000201', 'question', 'Deleted', 'Local only', 'deleted', 'published', 0),
  ('${ids.pending}', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000201', 'question', 'Pending', 'Local only', 'pending', 'published', 0),
  ('${ids.unmoderated}', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000201', 'question', 'Pending review', 'Local only', 'published', 'pending_review', 0),
  ('${ids.inaccessible}', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000202', 'question', 'Inaccessible', 'Local only', 'published', 'published', 0);
SET LOCAL session_replication_role = origin;
${observedExecutable}
GRANT EXECUTE ON FUNCTION ${signature} TO PUBLIC;
${calls([...allPostIds, ids.missing])}
SELECT ${callableName}(NULL);
${countLine("OBSERVED")}
${proposalOperations}
UPDATE public.posts SET view_count = 0 WHERE id IN (${allPostIds.map((id) => `'${id}'`).join(", ")});
${calls([...allPostIds, ids.missing])}
SELECT ${callableName}(NULL);
${countLine("CONVERGED_BEHAVIOR")}
SELECT 'CONVERGED_METADATA|' || encode(convert_to(${contractExpression}, 'UTF8'), 'hex') || '|' || coalesce((SELECT bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS acl), false) || '|' || has_function_privilege('anon', p.oid, 'EXECUTE') || '|' || has_function_privilege('authenticated', p.oid, 'EXECUTE') || '|' || has_function_privilege('service_role', p.oid, 'EXECUTE') FROM pg_proc p WHERE p.oid = '${signature}'::regprocedure;
ROLLBACK;
`);

const byPrefix = (prefix) => simulation.split(/\r?\n/).find((line) => line.startsWith(prefix));
const parseCounts = (line) => Object.fromEntries(line.split("|")[1].split(",").map((entry) => entry.split("=")));
assert.deepEqual(parseCounts(byPrefix("OBSERVED|")), {
  [ids.visible]: "1", [ids.hidden]: "0", [ids.deleted]: "0", [ids.pending]: "0", [ids.unmoderated]: "1", [ids.inaccessible]: "1",
});
assert.deepEqual(parseCounts(byPrefix("CONVERGED_BEHAVIOR|")), {
  [ids.visible]: "1", [ids.hidden]: "0", [ids.deleted]: "0", [ids.pending]: "0", [ids.unmoderated]: "0", [ids.inaccessible]: "0",
});
const [, encodedContract, publicExecute, anonExecute, authenticatedExecute, serviceRoleExecute] = byPrefix("CONVERGED_METADATA|").split("|");
assert.equal(hash(Buffer.from(encodedContract, "hex").toString("utf8")), expectedDefinition.deterministicSha256);
assert.deepEqual([publicExecute, anonExecute, authenticatedExecute, serviceRoleExecute], ["false", "true", "true", "false"]);
console.log(JSON.stringify({ localDockerOnly: true, packetRows: exportValidation.rowCount, observedHash: observed.definition_hash, expectedHash: expectedDefinition.deterministicSha256, behaviorConverged: true, metadataAclConverged: true, realProductionOperations: 0 }));
