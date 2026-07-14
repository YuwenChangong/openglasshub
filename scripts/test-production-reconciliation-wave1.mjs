import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalize } from "./production-schema-fingerprint-core.mjs";

const root = process.cwd();
const preflight = await readFile(path.join(root, "docs", "ops", "reconciliation", "legal-consent-production-wave1-preflight.sql"), "utf8");
const proposal = await readFile(path.join(root, "docs", "ops", "reconciliation", "legal-consent-production-wave1-proposal.sql"), "utf8");
const forwardPlan = await readFile(path.join(root, "docs", "ops", "legal-consent-production-forward-reconciliation-plan.md"), "utf8");
const manifest = JSON.parse(await readFile(path.join(root, "tests", "fixtures", "production-schema-forward-reconciliation.json"), "utf8"));
const expected = JSON.parse(await readFile(path.join(root, "tests", "fixtures", "production-schema-expected-fingerprint.json"), "utf8"));
const notificationSignature = "public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid)";
const viewSignature = "public.increment_post_view_count(uuid)";

const uncommentedPreflight = preflight.replace(/--[^\n]*/g, "");
assert.match(uncommentedPreflight, /^\s*BEGIN TRANSACTION READ ONLY;/);
assert.match(uncommentedPreflight, /\nROLLBACK;\s*$/);
assert.doesNotMatch(
  uncommentedPreflight,
  /^\s*(?:CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DO|CALL|EXECUTE)\b/im,
);
for (const [functionName, argumentTypes] of [
  ["increment_post_view_count", "uuid"],
  ["insert_forum_notification", "uuid, uuid, text, uuid, uuid, uuid"],
]) {
  assert.match(preflight, new RegExp(`'${functionName}'::name`));
  assert.match(preflight, new RegExp(`'${argumentTypes.replace(/, /g, ",\\s*")}'::text`));
}
assert.match(preflight, /pg_get_functiondef/);
assert.match(preflight, /to_regprocedure\(format\('%I\.%I\(%s\)'/);
assert.match(preflight, /aclexplode\(coalesce\(proacl/);

for (const marker of ["UNEXECUTED", "NON_PRODUCTION_REVIEW_PROPOSAL", "NOT FOR DIRECT PRODUCTION EXECUTION", "REQUIRES FRESH PREFLIGHT OUTPUT AND HUMAN APPROVAL"]) assert.match(proposal, new RegExp(marker));
assert.match(proposal, /ALTER FUNCTION public\.insert_forum_notification\(uuid, uuid, text, uuid, uuid, uuid\) OWNER TO postgres;/);
assert.match(proposal, /ALTER FUNCTION public\.insert_forum_notification\(uuid, uuid, text, uuid, uuid, uuid\) SECURITY DEFINER;/);
assert.match(proposal, /SET search_path TO public, pg_temp;/);
assert.match(proposal, /REVOKE ALL ON FUNCTION public\.insert_forum_notification\(uuid, uuid, text, uuid, uuid, uuid\) FROM PUBLIC;/);
assert.match(proposal, /REVOKE EXECUTE ON FUNCTION public\.insert_forum_notification\(uuid, uuid, text, uuid, uuid, uuid\) FROM anon, authenticated;/);
assert.match(proposal, /GRANT EXECUTE ON FUNCTION public\.insert_forum_notification\(uuid, uuid, text, uuid, uuid, uuid\) TO service_role;/);
assert.doesNotMatch(proposal, /increment_post_view_count/);
assert.doesNotMatch(proposal, /CREATE OR REPLACE FUNCTION|\$function\$|GRANT\s+(?:ALL|EXECUTE)\s+ON\s+FUNCTION[^;]+\s+TO\s+PUBLIC/i);
assert.match(forwardPlan, /`insert_forum_notification\(\.\.\.\)`: `EXACT_BODY_MATCH`/);
assert.match(forwardPlan, /`increment_post_view_count\(uuid\)`: forensic source evidence proves the body drift is security broadening/);

const waveOne = manifest.items.filter((item) => item.proposedWave === "W1_ACL_FUNCTION_HARDENING");
assert.deepEqual([...new Set(waveOne.map((item) => item.identity))].sort(), ["increment_post_view_count(uuid)", "insert_forum_notification(uuid,uuid,text,uuid,uuid,uuid)"]);
for (const item of waveOne.filter((item) => item.identity === "increment_post_view_count(uuid)")) assert.equal(item.proposalStatus, "PROPOSAL_AUTHORED_LOCAL_VALIDATED");
for (const item of waveOne.filter((item) => item.identity === "insert_forum_notification(uuid,uuid,text,uuid,uuid,uuid)")) assert.equal(item.proposalStatus, "PROPOSAL_AUTHORED_LOCAL_VALIDATED");

const expectedNotification = expected.objects.find((entry) => entry.identity === "insert_forum_notification(uuid,uuid,text,uuid,uuid,uuid)" && entry.attribute === "definition");
assert(expectedNotification, "expected notification definition is required");
const hash = (value) => createHash("sha256").update(normalize(value)).digest("hex");
const containerNames = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" }).split(/\r?\n/).filter((name) => name.startsWith("supabase_db_local-supabase-normalized-replay-"));
assert.equal(containerNames.length, 1, "LOCAL_DOCKER_ONLY requires one disposable normalized replay database container");
const container = containerNames[0];
const runLocalPsql = (sql) => execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { input: sql, encoding: "utf8" }).trim();
const localContract = runLocalPsql(`
SELECT 'returns=' || pg_get_function_result(p.oid)
  || ';security_definer=' || CASE WHEN p.prosecdef THEN 'true' ELSE 'false' END
  || ';owner=' || pg_get_userbyid(p.proowner)
  || ';search_path=' || coalesce(array_to_string(p.proconfig, ', '), '')
  || ';body=' || pg_get_functiondef(p.oid)
FROM pg_proc p
WHERE p.oid = '${notificationSignature}'::regprocedure;
`);
assert.equal(hash(localContract), expectedNotification.deterministicSha256, "local baseline notification contract must equal the expected fingerprint");
const operations = proposal.replace(/\nBEGIN;\s*/, "\n").replace(/\nCOMMIT;\s*$/, "\n");
const simulation = runLocalPsql(`
BEGIN;
REVOKE EXECUTE ON FUNCTION ${notificationSignature} FROM service_role;
GRANT EXECUTE ON FUNCTION ${notificationSignature} TO PUBLIC;
SELECT 'DRIFT|' || md5(pg_get_functiondef('${notificationSignature}'::regprocedure)) || '|' || coalesce((SELECT bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl), false) || '|' || has_function_privilege('anon', '${notificationSignature}', 'EXECUTE') || '|' || has_function_privilege('authenticated', '${notificationSignature}', 'EXECUTE') || '|' || has_function_privilege('service_role', '${notificationSignature}', 'EXECUTE') FROM pg_proc p WHERE p.oid = '${notificationSignature}'::regprocedure;
${operations}
SELECT 'CONVERGED|' || md5(pg_get_functiondef('${notificationSignature}'::regprocedure)) || '|' || pg_get_userbyid(p.proowner) || '|' || p.prosecdef || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|' || coalesce((SELECT bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl), false) || '|' || has_function_privilege('anon', p.oid, 'EXECUTE') || '|' || has_function_privilege('authenticated', p.oid, 'EXECUTE') || '|' || has_function_privilege('service_role', p.oid, 'EXECUTE') FROM pg_proc p WHERE p.oid = '${notificationSignature}'::regprocedure;
ROLLBACK;
`);
const [drift, converged] = simulation.split(/\r?\n/).filter((line) => line.startsWith("DRIFT|") || line.startsWith("CONVERGED|"));
assert.match(drift, /^DRIFT\|[a-f0-9]{32}\|true\|true\|true\|true$/);
const [, beforeBodyHash] = drift.split("|");
const [, afterBodyHash, owner, securityDefiner, searchPath, publicExecute, anonExecute, authenticatedExecute, serviceRoleExecute] = converged.split("|");
assert.equal(afterBodyHash, beforeBodyHash, "ACL convergence must preserve the local function body");
assert.equal(owner, "postgres");
assert.equal(securityDefiner, "true");
assert.equal(searchPath, "search_path=public, pg_temp");
assert.deepEqual([publicExecute, anonExecute, authenticatedExecute, serviceRoleExecute], ["false", "false", "false", "true"]);
console.log(JSON.stringify({ localDockerOnly: true, notificationBodyHash: expectedNotification.deterministicSha256, bodyPreserved: true, driftReproduced: true, converged: true, wave1bProposalStatus: "PROPOSAL_AUTHORED_LOCAL_VALIDATED", realOperations: 0 }));
