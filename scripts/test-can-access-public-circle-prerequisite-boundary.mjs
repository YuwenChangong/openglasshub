import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalize } from "./production-schema-fingerprint-core.mjs";

const root = process.cwd();
const packetDirectory = path.join(root, "docs", "ops", "reconciliation");
const proposal = await readFile(path.join(packetDirectory, "can-access-public-circle-proposal.sql"), "utf8");
const postflight = await readFile(path.join(packetDirectory, "can-access-public-circle-postflight.sql"), "utf8");
const waveOneProposal = await readFile(path.join(packetDirectory, "legal-consent-production-wave1-proposal.sql"), "utf8");
const waveOnePostflight = await readFile(path.join(packetDirectory, "legal-consent-production-wave1-postflight.sql"), "utf8");
const expected = JSON.parse(await readFile(path.join(root, "tests", "fixtures", "production-schema-expected-fingerprint.json"), "utf8"));
const uncommentedProposal = proposal.replace(/--[^\n]*/g, "");
const uncommentedPostflight = postflight.replace(/--[^\n]*/g, "");
const functionSignature = "public.can_access_public_circle(uuid)";
const expectedFunction = expected.objects.find((entry) => entry.objectType === "function" && entry.identity === "can_access_public_circle(uuid)" && entry.attribute === "definition");
assert(expectedFunction, "expected function fingerprint is required");

for (const marker of ["UNEXECUTED", "PRODUCTION_REVIEW_PROPOSAL", "WAVE 1 PREREQUISITE", "NOT A CANONICAL MIGRATION", "NOT MIGRATION-HISTORY REPAIR", "DOES NOT RECONCILE CIRCLES POLICIES OR CONSTRAINTS", "EXPLICIT HUMAN PRODUCTION APPROVAL"]) {
  assert.match(proposal, new RegExp(marker));
}
assert.equal((proposal.match(/CREATE FUNCTION public\.can_access_public_circle/g) ?? []).length, 1, "proposal creates exactly the prerequisite function");
assert.doesNotMatch(uncommentedProposal, /(?:CREATE|ALTER|DROP)\s+(?:TABLE|POLICY|INDEX)|(?:circles_status_check|circles_select_public|circles_delete_owner_or_staff)/i, "proposal cannot reconcile circles schema or policies");
assert.doesNotMatch(uncommentedProposal, /(?:increment_post_view_count|insert_forum_notification|schema_migrations|migration repair|GRANT\s+ALL)/i, "proposal cannot broaden to Wave 1 targets or migration repair");
assert.match(uncommentedProposal, /REVOKE ALL ON FUNCTION public\.can_access_public_circle\(uuid\) FROM PUBLIC, anon, authenticated, service_role;/);
assert.match(uncommentedProposal, /GRANT EXECUTE ON FUNCTION public\.can_access_public_circle\(uuid\) TO anon, authenticated;/);

assert.match(uncommentedPostflight, /^\s*BEGIN TRANSACTION READ ONLY;/);
assert.match(uncommentedPostflight, /\nROLLBACK;\s*$/);
assert.doesNotMatch(uncommentedPostflight, /^\s*(?:CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DO|CALL|EXECUTE)\b/im);
for (const required of ["pg_get_functiondef", "normalized_function_body_hash", "aclexplode", "circles_status_constraint", "circles_select_policy", "circles_delete_policy"]) assert.match(postflight, new RegExp(required));

const containers = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter((name) => name.startsWith("supabase_db_local-supabase-normalized-replay-"));
assert.equal(containers.length, 1, "LOCAL_DOCKER_ONLY requires one disposable normalized replay database container");
const container = containers[0];
const psql = (input, stop = true) => {
  const result = spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-v", `ON_ERROR_STOP=${stop ? 1 : 0}`, "-U", "postgres", "-d", "postgres"], { input, encoding: "utf8" });
  if (stop && result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result;
};
const stripTransaction = (sql, startPattern) => sql.replace(startPattern, "").replace(/\s*(?:COMMIT|ROLLBACK);\s*$/, "");
const prerequisiteOperations = stripTransaction(proposal, /^\s*BEGIN;\s*/m);
const prerequisitePostflightOperations = stripTransaction(postflight, /^\s*BEGIN TRANSACTION READ ONLY;\s*/m);
const waveOneOperations = stripTransaction(waveOneProposal, /^\s*BEGIN;\s*/m);
const waveOnePostflightOperations = stripTransaction(waveOnePostflight, /^\s*BEGIN TRANSACTION READ ONLY;\s*/m);
const surroundingDrift = `
ALTER TABLE public.circles DROP CONSTRAINT circles_status_check;
ALTER TABLE public.circles ADD CONSTRAINT circles_status_check CHECK (status IN ('active', 'hidden', 'deleted'));
DROP POLICY IF EXISTS "circles_select_public" ON public.circles;
CREATE POLICY "circles_select_public" ON public.circles FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "circles_delete_owner_or_staff" ON public.circles;
CREATE POLICY "circles_delete_owner_or_staff" ON public.circles FOR DELETE TO authenticated USING (
  owner_id = auth.uid() OR (SELECT public.is_moderator_or_admin())
);
`;
const observedWaveOneDrift = `
CREATE OR REPLACE FUNCTION public.increment_post_view_count(p_post_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  update public.posts set view_count = coalesce(view_count, 0) + 1
  where id = p_post_id and status = 'published';
$function$;
ALTER FUNCTION public.increment_post_view_count(uuid) OWNER TO postgres;
ALTER FUNCTION public.increment_post_view_count(uuid) SECURITY DEFINER;
ALTER FUNCTION public.increment_post_view_count(uuid) SET search_path TO public;
REVOKE ALL ON FUNCTION public.increment_post_view_count(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_post_view_count(uuid) TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid) TO anon, authenticated;
`;

const failedWaveOne = psql(`BEGIN;
DROP FUNCTION ${functionSignature} CASCADE;
${surroundingDrift}
${observedWaveOneDrift}
${waveOneOperations}
ROLLBACK;
`, false);
assert.equal(failedWaveOne.status, 0, "the missing-prerequisite replay must roll back cleanly");
assert.match(failedWaveOne.stdout + "\n" + failedWaveOne.stderr, /function public\.can_access_public_circle\(uuid\) does not exist/, "existing Wave 1 must fail only because the helper is missing");

const simulation = psql(`BEGIN;
DROP FUNCTION ${functionSignature} CASCADE;
${surroundingDrift}
${observedWaveOneDrift}
INSERT INTO public.circles (id, slug, name, type, status) VALUES
  ('10000000-0000-4000-8000-000000000001', 'prereq-active', 'Prerequisite Active', 'topic', 'active'),
  ('10000000-0000-4000-8000-000000000002', 'prereq-hidden', 'Prerequisite Hidden', 'topic', 'hidden'),
  ('10000000-0000-4000-8000-000000000003', 'prereq-deleted', 'Prerequisite Deleted', 'topic', 'deleted');
SELECT 'MISSING|' || coalesce(to_regprocedure('public.can_access_public_circle(uuid)')::text, 'none');
SELECT 'DRIFT_BEFORE|' || md5((SELECT pg_get_constraintdef(oid, true) FROM pg_constraint WHERE conrelid = 'public.circles'::regclass AND conname = 'circles_status_check')) || '|' || md5((SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polrelid = 'public.circles'::regclass AND polname = 'circles_select_public')) || '|' || md5((SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polrelid = 'public.circles'::regclass AND polname = 'circles_delete_owner_or_staff'));
${prerequisiteOperations}
${prerequisitePostflightOperations}
SELECT 'BEHAVIOR|' || public.can_access_public_circle('10000000-0000-4000-8000-000000000001') || '|' || public.can_access_public_circle('10000000-0000-4000-8000-000000000002') || '|' || public.can_access_public_circle('10000000-0000-4000-8000-000000000003') || '|' || public.can_access_public_circle(NULL) || '|' || public.can_access_public_circle('10000000-0000-4000-8000-000000000099');
SET LOCAL ROLE anon;
SELECT 'ANON_BEHAVIOR|' || public.can_access_public_circle('10000000-0000-4000-8000-000000000001') || '|' || public.can_access_public_circle('10000000-0000-4000-8000-000000000002');
RESET ROLE;
${waveOneOperations}
${waveOnePostflightOperations}
SELECT 'DRIFT_AFTER|' || md5((SELECT pg_get_constraintdef(oid, true) FROM pg_constraint WHERE conrelid = 'public.circles'::regclass AND conname = 'circles_status_check')) || '|' || md5((SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polrelid = 'public.circles'::regclass AND polname = 'circles_select_public')) || '|' || md5((SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polrelid = 'public.circles'::regclass AND polname = 'circles_delete_owner_or_staff'));
SELECT 'CONTRACT|' || encode(convert_to('returns=' || pg_get_function_result(p.oid) || ';security_definer=' || CASE WHEN p.prosecdef THEN 'true' ELSE 'false' END || ';owner=' || pg_get_userbyid(p.proowner) || ';search_path=' || coalesce(array_to_string(p.proconfig, ', '), '') || ';body=' || pg_get_functiondef(p.oid), 'UTF8'), 'hex') || '|' || has_function_privilege('anon', p.oid, 'EXECUTE') || '|' || has_function_privilege('authenticated', p.oid, 'EXECUTE') || '|' || has_function_privilege('service_role', p.oid, 'EXECUTE') FROM pg_proc p WHERE p.oid = '${functionSignature}'::regprocedure;
ROLLBACK;
`).stdout;
const line = (prefix) => simulation.split(/\r?\n/).find((value) => value.startsWith(prefix));
assert.equal(line("MISSING|"), "MISSING|none");
assert.match(line("BEHAVIOR|"), /^BEHAVIOR\|true\|false\|false\|false\|false$/, "active is allowed while hidden, deleted, NULL, and nonexistent circles are denied");
assert.equal(line("ANON_BEHAVIOR|"), "ANON_BEHAVIOR|true|false", "the broad SELECT policy does not alter the SECURITY DEFINER helper result");
assert.equal(line("DRIFT_BEFORE|").replace("DRIFT_BEFORE|", ""), line("DRIFT_AFTER|").replace("DRIFT_AFTER|", ""), "the prerequisite and Wave 1 packets leave surrounding constraint and policies unchanged");
const [, contractHex, anonExecute, authenticatedExecute, serviceRoleExecute] = line("CONTRACT|").split("|");
assert.equal(createHash("sha256").update(normalize(Buffer.from(contractHex, "hex").toString("utf8"))).digest("hex"), expectedFunction.deterministicSha256, "prerequisite body and metadata converge to the expected fingerprint");
assert.deepEqual([anonExecute, authenticatedExecute, serviceRoleExecute], ["true", "true", "false"], "only expected browser-role EXECUTE grants remain");

assert.equal(psql("SELECT to_regprocedure('public.can_access_public_circle(uuid)') IS NOT NULL;").stdout.trim(), "t", "all local drift simulation changes must roll back");
assert.equal(execFileSync("git", ["diff", "--name-only", "HEAD", "--", "supabase/migrations", "src"], { cwd: root, encoding: "utf8" }).trim(), "", "canonical migrations and runtime must remain unchanged");
assert.doesNotMatch(execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }), /can-access-public-circle-preflight\.csv/i, "production CSV must remain untracked");

console.log(JSON.stringify({
  localDockerOnly: true,
  missingFunctionReproduced: true,
  hiddenDeletedNullNonexistentDenied: true,
  broadSelectDoesNotAlterHelper: true,
  deletePolicyDoesNotAlterHelper: true,
  surroundingDriftPreserved: true,
  prerequisiteAndWaveOneConverged: true,
  realProductionOperations: 0,
}));
