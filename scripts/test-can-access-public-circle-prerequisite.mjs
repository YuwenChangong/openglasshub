import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalize } from "./production-schema-fingerprint-core.mjs";

const root = process.cwd();
const preflight = await readFile(path.join(root, "docs", "ops", "reconciliation", "can-access-public-circle-preflight.sql"), "utf8");
const report = await readFile(path.join(root, "docs", "ops", "legal-consent-production-reconciliation-wave1-prerequisite.md"), "utf8");
const waveOneProposal = await readFile(path.join(root, "docs", "ops", "reconciliation", "legal-consent-production-wave1-proposal.sql"), "utf8");
const expected = JSON.parse(await readFile(path.join(root, "tests", "fixtures", "production-schema-expected-fingerprint.json"), "utf8"));
const manifest = JSON.parse(await readFile(path.join(root, "tests", "fixtures", "production-schema-forward-reconciliation.json"), "utf8"));
const uncommented = preflight.replace(/--[^\n]*/g, "");

assert.match(uncommented, /^\s*BEGIN TRANSACTION READ ONLY;/);
assert.match(uncommented, /\nROLLBACK;\s*$/);
assert.doesNotMatch(uncommented, /^\s*(?:CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DO|CALL|EXECUTE)\b/im);
assert.match(preflight, /to_regprocedure\('public\.can_access_public_circle\(uuid\)'\)/);
for (const required of ["to_regclass('public.circles')", "pg_get_functiondef", "aclexplode", "id", "status", "slug", "name", "anon", "authenticated", "postgres", "pg_constraint", "pg_policy"]) assert.match(preflight, new RegExp(required.replace(/[().]/g, "\\$&")));
assert.doesNotMatch(preflight, /(?:increment_post_view_count|insert_forum_notification|can_access_public_comment_read_target|post_media|legal_policy_acceptances)/);

assert.match(report, /PROPOSAL_AUTHORED_LOCAL_VALIDATED_UNEXECUTED/);
assert.match(report, /PROPOSAL_AUTHORED_LOCAL_VALIDATED_UNEXECUTED/);
assert.match(report, /function public\.can_access_public_circle\(uuid\) does not exist/);

const functionDefinition = expected.objects.find((entry) => entry.objectType === "function" && entry.identity === "can_access_public_circle(uuid)" && entry.attribute === "definition");
assert(functionDefinition, "expected circle-access definition is required");
const expectedAcl = new Map(expected.objects.filter((entry) => entry.identity === "can_access_public_circle(uuid)").map((entry) => [entry.attribute, entry.normalizedStructuralDefinition]));
assert.equal(expectedAcl.get("PUBLIC_execute"), "false");
assert.equal(expectedAcl.get("anon_execute"), "true");
assert.equal(expectedAcl.get("authenticated_execute"), "true");

const containers = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" }).split(/\r?\n/).filter((name) => name.startsWith("supabase_db_local-supabase-normalized-replay-"));
assert.equal(containers.length, 1, "LOCAL_DOCKER_ONLY requires one disposable normalized replay database container");
const psql = (sql) => execFileSync("docker", ["exec", "-i", containers[0], "psql", "-X", "-qAt", "-F", "|", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { input: sql, encoding: "utf8" }).trim();
const local = psql(`SELECT 'returns=' || pg_get_function_result(p.oid) || ';security_definer=' || CASE WHEN p.prosecdef THEN 'true' ELSE 'false' END || ';owner=' || pg_get_userbyid(p.proowner) || ';search_path=' || coalesce(array_to_string(p.proconfig, ', '), '') || ';body=' || pg_get_functiondef(p.oid) || '|volatility=' || p.provolatile::text || '|strict=' || p.proisstrict || '|leakproof=' || p.proleakproof || '|parallel=' || p.proparallel::text FROM pg_proc p WHERE p.oid = 'public.can_access_public_circle(uuid)'::regprocedure;`);
const [contract, volatility, strictness, leakproof, parallel] = local.split("|");
assert.equal(createHash("sha256").update(normalize(contract)).digest("hex"), functionDefinition.deterministicSha256);
assert.deepEqual([volatility, strictness, leakproof, parallel], ["volatility=s", "strict=false", "leakproof=false", "parallel=u"]);
assert.match(contract, /circle_ref\.status = 'active'/);
assert.match(contract, /rls-test-circle/);
assert.match(contract, /lower\(coalesce\(circle_ref\.name, ''\)\) not like '%rls test%'/);

const proposalOperations = waveOneProposal.replace(/^\s*BEGIN;\s*/m, "").replace(/\s*COMMIT;\s*$/, "");
const missingPrerequisiteSimulation = spawnSync("docker", ["exec", "-i", containers[0], "psql", "-X", "-q", "-v", "ON_ERROR_STOP=0", "-U", "postgres", "-d", "postgres"], {
  input: "BEGIN;\nDROP FUNCTION public.can_access_public_circle(uuid) CASCADE;\n" + proposalOperations + "\nROLLBACK;\n",
  encoding: "utf8",
});
assert.equal(missingPrerequisiteSimulation.status, 0, "the disposable simulation must roll back cleanly");
assert.match(missingPrerequisiteSimulation.stdout + "\n" + missingPrerequisiteSimulation.stderr, /function public\.can_access_public_circle\(uuid\) does not exist/, "the existing Wave 1 proposal must reproduce the missing prerequisite failure locally");
assert.equal(psql("SELECT to_regprocedure('public.can_access_public_circle(uuid)') IS NOT NULL;"), "t", "the simulation must leave the verified local baseline unchanged");

const dependencyState = manifest.items.filter((item) => item.identity === "can_access_public_circle(uuid)");
assert(dependencyState.length >= 3);
for (const item of dependencyState) assert.equal(item.productionDataState, "ADDITIONAL_READ_ONLY_PREFLIGHT_REQUIRED");
assert.equal(execFileSync("git", ["diff", "--name-only", "HEAD", "--", "supabase/migrations", "src", "package-lock.json"], { cwd: root, encoding: "utf8" }).trim(), "");
const trackedFiles = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
assert.doesNotMatch(trackedFiles, /(?:production-schema-fingerprint\.csv|increment-post-view-count-body\.csv|can-access-public-circle-preflight\.csv)/i, "production exports must remain untracked");

console.log(JSON.stringify({ localDockerOnly: true, expectedFunctionHash: functionDefinition.deterministicSha256, productionDependencyState: "PROPOSAL_AUTHORED_LOCAL_VALIDATED_UNEXECUTED", proposalAuthored: true, realProductionOperations: 0 }));
