import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const reconciliationDirectory = path.join(root, "docs", "ops", "reconciliation");
const preflight = await readFile(path.join(reconciliationDirectory, "circles-visibility-production-execution-preflight.sql"), "utf8");
const proposal = await readFile(path.join(reconciliationDirectory, "circles-visibility-production-proposal.sql"), "utf8");
const postflight = await readFile(path.join(reconciliationDirectory, "circles-visibility-production-postflight.sql"), "utf8");
const documentation = await readFile(path.join(root, "docs", "ops", "legal-consent-production-circles-visibility-reconciliation.md"), "utf8");
const manifest = JSON.parse(await readFile(path.join(root, "tests", "fixtures", "production-schema-forward-reconciliation.json"), "utf8"));
const withoutComments = (sql) => sql.replace(/--[^\n]*/g, "");
const readOnlyPacket = (name, sql) => {
  const executable = withoutComments(sql);
  assert.match(executable, /^\s*BEGIN TRANSACTION READ ONLY;/, `${name} must begin a read-only transaction`);
  assert.match(executable, /\nROLLBACK;\s*$/, `${name} must roll back`);
  assert.doesNotMatch(executable, /^\s*(?:CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|MERGE|TRUNCATE|COPY|DO|CALL|EXECUTE)\b/im, `${name} must not write`);
};
readOnlyPacket("execution preflight", preflight);
readOnlyPacket("postflight", postflight);

for (const marker of ["UNEXECUTED", "PRODUCTION_REVIEW_PROPOSAL", "NOT A CANONICAL MIGRATION", "NOT MIGRATION-HISTORY REPAIR", "REQUIRES FRESH PREFLIGHT", "REQUIRES EXPLICIT HUMAN PRODUCTION APPROVAL", "SCOPE LIMITED TO THREE CIRCLES OBJECTS"]) {
  assert.match(proposal, new RegExp(marker));
}
assert.match(proposal, /ALTER TABLE public\.circles ADD CONSTRAINT circles_status_check_narrowed/);
assert.match(proposal, /ALTER TABLE public\.circles VALIDATE CONSTRAINT circles_status_check_narrowed/);
assert.match(proposal, /ALTER TABLE public\.circles DROP CONSTRAINT circles_status_check/);
assert.match(proposal, /ALTER TABLE public\.circles RENAME CONSTRAINT circles_status_check_narrowed TO circles_status_check/);
assert.match(proposal, /DROP POLICY "circles_select_public" ON public\.circles;/);
assert.match(proposal, /CREATE POLICY "circles_select_public" ON public\.circles/);
assert.match(proposal, /public\.can_access_public_circle\(id\)/);
assert.match(proposal, /owner_id = auth\.uid\(\)/);
assert.match(proposal, /public\.is_moderator_or_admin\(\)/);
assert.match(proposal, /DROP POLICY "circles_delete_owner_or_staff" ON public\.circles;/);
assert.doesNotMatch(proposal, /CREATE POLICY "circles_delete_owner_or_staff"/);
assert.doesNotMatch(withoutComments(proposal), /\b(?:INSERT|UPDATE|DELETE\s+FROM|MERGE|TRUNCATE|GRANT|REVOKE|ALTER TABLE[^;]*(?:DISABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY))\b/i);
assert.doesNotMatch(withoutComments(proposal), /(?:increment_post_view_count|insert_forum_notification|can_access_public_circle\(uuid\).*CREATE|schema_migrations|migration repair|EXECUTE\s+IMMEDIATE)/i);
for (const sql of [preflight, postflight]) {
  assert.match(sql, /hidden_count/);
  assert.match(sql, /expected_anonymous_visible_count/);
  assert.doesNotMatch(sql, /SELECT\s+\*\s+FROM\s+public\.circles/i);
}

const targetIdentities = ["public.circles.circles_status_check", "public.circles.circles_select_public", "public.circles.circles_delete_owner_or_staff"];
assert.deepEqual(manifest.circlesVisibilityPreflight.repairObjects, targetIdentities);
assert.equal(manifest.circlesVisibilityPreflight.proposalStatus, "PROPOSAL_AUTHORED_LOCAL_VALIDATED_UNEXECUTED");
for (const item of manifest.items.filter((item) => targetIdentities.includes(item.identity))) {
  assert.equal(item.proposalStatus, "PROPOSAL_AUTHORED_LOCAL_VALIDATED_UNEXECUTED");
  assert.equal(item.productionExecutionStatus, "NOT_EXECUTED");
}
assert.match(documentation, /REMOVE_DIRECT_HARD_DELETE_POLICY/);
assert.match(documentation, /PROPOSAL_AUTHORED_LOCAL_VALIDATED_UNEXECUTED/);

const changedMigrations = execFileSync("git", ["diff", "--name-only", "HEAD", "--", "supabase/migrations"], { cwd: root, encoding: "utf8" }).trim();
const changedRuntime = execFileSync("git", ["diff", "--name-only", "HEAD", "--", "src"], { cwd: root, encoding: "utf8" }).trim();
assert.equal(changedMigrations, "", "canonical migrations must remain unchanged");
assert.equal(changedRuntime, "", "runtime application files must remain unchanged");
assert.equal(execFileSync("git", ["ls-files", "--", "**/circles-visibility-production-preflight.csv"], { cwd: root, encoding: "utf8" }).trim(), "", "production CSV must not be tracked");

const containers = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" })
  .split(/\r?\n/).filter((name) => name.startsWith("supabase_db_local-supabase-normalized-replay-"));
assert.equal(containers.length, 1, "LOCAL_DOCKER_ONLY requires exactly one disposable normalized replay container");
const container = containers[0];
const psql = (input, stop = true) => {
  const result = spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-v", `ON_ERROR_STOP=${stop ? 1 : 0}`, "-U", "postgres", "-d", "postgres"], { input, encoding: "utf8" });
  if (stop && result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result;
};
const stripTransaction = (sql, start) => sql.replace(start, "").replace(/\s*(?:COMMIT|ROLLBACK);\s*$/, "");
const proposalOperations = stripTransaction(proposal, /^\s*BEGIN;\s*/m);
const postflightOperations = stripTransaction(postflight, /^\s*BEGIN TRANSACTION READ ONLY;\s*/m);

const simulation = psql(`
BEGIN;
ALTER TABLE public.circles DROP CONSTRAINT circles_status_check;
ALTER TABLE public.circles ADD CONSTRAINT circles_status_check CHECK (status IN ('active', 'hidden', 'deleted'));
DROP POLICY IF EXISTS "circles_select_public" ON public.circles;
CREATE POLICY "circles_select_public" ON public.circles FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "circles_delete_owner_or_staff" ON public.circles;
CREATE POLICY "circles_delete_owner_or_staff" ON public.circles FOR DELETE TO authenticated
  USING (owner_id = auth.uid() OR (SELECT public.is_moderator_or_admin()));
INSERT INTO auth.users (id, aud, role, email, encrypted_password) VALUES
  ('7a100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'local-circle-owner@example.test', 'local-only'),
  ('7a200000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'local-circle-staff@example.test', 'local-only');
UPDATE public.profiles SET role = 'moderator' WHERE id = '7a200000-0000-4000-8000-000000000002';
INSERT INTO public.circles (id, slug, name, type, owner_id, status)
SELECT ('7b000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  CASE WHEN series = 8 THEN 'rls-test-circle' ELSE 'public-circle-' || series::text END,
  CASE WHEN series = 8 THEN 'RLS Test Circle' ELSE 'Public Circle ' || series::text END,
  'topic', CASE WHEN series = 8 THEN '7a100000-0000-4000-8000-000000000001'::uuid ELSE NULL END, 'active'
FROM generate_series(1, 8) AS series;
INSERT INTO public.circles (id, slug, name, type, status)
SELECT ('7c000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  'deleted-circle-' || series::text, 'Deleted Circle ' || series::text, 'topic', 'deleted'
FROM generate_series(1, 53) AS series;
SELECT 'DRIFT|' || (SELECT count(*) FROM public.circles WHERE id::text LIKE '7b%' OR id::text LIKE '7c%') || '|' ||
  (SELECT count(*) FROM public.circles WHERE id::text LIKE '7b%' AND status = 'active') || '|' ||
  (SELECT count(*) FROM public.circles WHERE id::text LIKE '7c%' AND status = 'deleted') || '|' ||
  (SELECT count(*) FROM public.circles WHERE id::text LIKE '7b%' AND status = 'hidden') || '|' ||
  (SELECT coalesce(pg_get_expr(polqual, polrelid), '') FROM pg_policy WHERE polrelid = 'public.circles'::regclass AND polname = 'circles_select_public') || '|' ||
  (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.circles'::regclass AND polname = 'circles_delete_owner_or_staff');
${proposalOperations}
SET LOCAL ROLE anon;
SELECT 'ANON|' || (SELECT count(*) FROM public.circles WHERE id = '7b000000-0000-4000-8000-000000000001') || '|' ||
  (SELECT count(*) FROM public.circles WHERE id = '7c000000-0000-4000-8000-000000000001') || '|' ||
  (SELECT count(*) FROM public.circles WHERE id = '7b000000-0000-4000-8000-000000000008');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '7a100000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT 'OWNER|' || (SELECT count(*) FROM public.circles WHERE id = '7b000000-0000-4000-8000-000000000008');
UPDATE public.circles SET status = 'deleted' WHERE id = '7b000000-0000-4000-8000-000000000008' RETURNING 'SOFT_DELETE|' || status;
DELETE FROM public.circles WHERE id = '7b000000-0000-4000-8000-000000000008' RETURNING 'HARD_DELETE|' || id;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '7a200000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT 'STAFF|' || (SELECT count(*) FROM public.circles WHERE id = '7b000000-0000-4000-8000-000000000008');
RESET ROLE;
DO $local_constraint_test$
BEGIN
  BEGIN
    INSERT INTO public.circles (id, slug, name, type, status) VALUES ('7d000000-0000-4000-8000-000000000001', 'hidden-rejected', 'Hidden Rejected', 'topic', 'hidden');
    RAISE EXCEPTION 'hidden status was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$local_constraint_test$;
INSERT INTO public.circles (id, slug, name, type, status) VALUES
  ('7d000000-0000-4000-8000-000000000002', 'active-accepted', 'Active Accepted', 'topic', 'active'),
  ('7d000000-0000-4000-8000-000000000003', 'deleted-accepted', 'Deleted Accepted', 'topic', 'deleted');
SELECT 'CONVERGED|' ||
  (SELECT pg_get_constraintdef(oid, true) FROM pg_constraint WHERE conrelid = 'public.circles'::regclass AND conname = 'circles_status_check') || '|' ||
  (SELECT coalesce(pg_get_expr(polqual, polrelid), '') FROM pg_policy WHERE polrelid = 'public.circles'::regclass AND polname = 'circles_select_public') || '|' ||
  (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.circles'::regclass AND polcmd = 'd') || '|' ||
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.circles'::regclass) || '|' ||
  (SELECT md5(regexp_replace(trim(prosrc), E'\\s+', ' ', 'g')) FROM pg_proc WHERE oid = 'public.increment_post_view_count(uuid)'::regprocedure) || '|' ||
  (SELECT md5(regexp_replace(trim(prosrc), E'\\s+', ' ', 'g')) FROM pg_proc WHERE oid = 'public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid)'::regprocedure);
${postflightOperations}
ROLLBACK;
`).stdout;
const line = (prefix) => simulation.split(/\r?\n/).find((value) => value.startsWith(prefix));
assert.match(line("DRIFT|"), /^DRIFT\|61\|8\|53\|0\|true\|1$/, "local fixture must reproduce the reviewed aggregate drift");
assert.equal(line("ANON|"), "ANON|1|0|0", "post-proposal anonymous reads must admit public active only");
assert.equal(line("OWNER|"), "OWNER|1", "owner branch must retain its source-backed access");
assert.equal(line("SOFT_DELETE|"), "SOFT_DELETE|deleted", "supported soft deletion must remain functional");
assert.equal(line("HARD_DELETE|"), undefined, "removed direct DELETE policy must deny hard delete with zero rows");
assert.equal(line("STAFF|"), "STAFF|1", "staff branch must retain its source-backed access");
assert.match(line("CONVERGED|"), /^CONVERGED\|CHECK \(status = ANY \(ARRAY\['active'::text, 'deleted'::text\]\)\)\|\(can_access_public_circle\(id\) OR \(owner_id = auth\.uid\(\)\) OR \( SELECT is_moderator_or_admin\(\) AS is_moderator_or_admin\)\)\|0\|true\|[a-f0-9]{32}\|[a-f0-9]{32}$/);

console.log(JSON.stringify({ localDockerOnly: true, reviewedDriftReproduced: true, aggregateFixture: { active: 8, deleted: 53, hidden: 0 }, anonymousVisibility: { before: 61, after: 7 }, ownerAndStaffRetained: true, directHardDeleteDenied: true, softDeleteFunctional: true, waveOneUnchanged: true, noProductionOperations: true }));
