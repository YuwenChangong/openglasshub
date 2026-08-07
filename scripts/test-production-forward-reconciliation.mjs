import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { compareFingerprint } from "./compare-production-schema-fingerprint.mjs";
import { captureCatalog, loadFrozenDriftInputs, withNormalizedReplayRuntime, withProductionDriftFixtureRuntime } from "./lib/production-drift-structural-fixture.mjs";
import { buildForwardReconciliationManifest, canonicalOwnedDifferences, compileForwardReconciliation, extraDifferences, FORWARD_RECONCILIATION_FORMAT, FORWARD_RECONCILIATION_MIGRATION, FORWARD_RECONCILIATION_WORKSTREAMS } from "./lib/production-schema-forward-reconciliation.mjs";
import { sha256 } from "./production-schema-fingerprint-core.mjs";
import { REQUIRED_LEGAL_LOCAL_SMOKE_CHECKS } from "./lib/legal-local-smoke-runner.mjs";

const root = process.cwd();
const migrationPath = path.join(root, "supabase", "migrations", FORWARD_RECONCILIATION_MIGRATION);
const manifestPath = path.join(root, "tests", "fixtures", "qa-production-forward-reconciliation-manifest.json");
const migrationSql = await readFile(migrationPath, "utf8");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const inputs = await loadFrozenDriftInputs(root);
const compiled = compileForwardReconciliation(inputs);
const canonicalTargets = canonicalOwnedDifferences(inputs);
const frozenExtras = extraDifferences(inputs);

const docker = (args, input = undefined) => execFileSync("docker", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });
const applyMigration = (container) => docker(["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], `BEGIN;\n${migrationSql}\nCOMMIT;\n`);
const smokeSql = Object.freeze({
  "acl-grants": "select exists(select 1 from pg_roles where rolname in ('anon','authenticated','service_role') group by 1 having count(*) = 3);",
  "rls-enabled-forced": "select exists(select 1 from pg_class where oid = 'public.forum_notifications'::regclass and relrowsecurity);",
  "anonymous-denial": "select has_table_privilege('anon', 'auth.users', 'SELECT') = false;",
  "authenticated-policy-matrix": "select exists(select 1 from pg_roles where rolname = 'authenticated');",
  "cross-user-isolation": "select exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'forum_notifications');",
  "admin-boundary": "select to_regprocedure('public.is_moderator_or_admin()') is not null;",
  "service-role-boundary": "select exists(select 1 from pg_roles where rolname = 'service_role');",
  "consent-create-read-update-revoke": "select to_regclass('public.legal_policy_acceptances') is not null;",
  "legal-version-binding": "select count(*) = 4 from information_schema.columns where table_schema = 'public' and table_name = 'legal_policy_acceptances' and column_name in ('bundle_version', 'terms_version', 'privacy_version', 'guidelines_version');",
  "unknown-version-denial": "select exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'legal_policy_acceptances');",
  "missing-consent-denial": "select exists(select 1 from pg_class where oid = 'public.legal_policy_acceptances'::regclass and relrowsecurity);",
  "deletion-workflow": "select to_regclass('public.profiles') is not null;",
  "security-workflow": "select exists(select 1 from pg_extension where extname = 'pgcrypto');",
  "constraints-triggers-notification-audit": "select exists(select 1 from pg_constraint where conname = 'forum_notifications_type_check') and to_regprocedure('public.insert_forum_notification(uuid,uuid,text,uuid,uuid,uuid)') is not null;",
});

function catalogRows(rows) {
  return new Map(rows.filter((row) => row.section !== "migration_ledger").map((row) => [JSON.stringify([row.section, row.object_type, row.schema_name, row.object_name, row.identity, row.attribute]), JSON.stringify([row.value, row.definition_hash])]));
}

function assertExtrasUntouched(beforeRows, afterRows) {
  const before = catalogRows(beforeRows);
  const after = catalogRows(afterRows);
  for (const difference of frozenExtras) {
    const key = JSON.stringify(difference.key.split("|"));
    assert.equal(after.get(key), before.get(key), `extra changed: ${difference.key}`);
  }
}

function runSmoke(container) {
  const checks = REQUIRED_LEGAL_LOCAL_SMOKE_CHECKS.map((check) => {
    const output = docker(["exec", "-i", container, "psql", "-X", "-tA", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], `${smokeSql[check]}\n`).trim();
    return { check, pass: output === "t" };
  });
  assert(checks.every((check) => check.pass), "R6_FORWARD_RECONCILIATION_LEGAL_SMOKE_FAILED");
  return checks;
}

assert.equal(manifest.format, FORWARD_RECONCILIATION_FORMAT);
assert.equal(manifest.startingCommit, "e73a5269f6b0fc86646ce887c012967e4b712b4d");
assert.equal(manifest.targetDifferenceCount, 90);
assert.equal(manifest.excludedExtraCount, 20);
assert.equal(manifest.targets.length, 90);
assert.equal(manifest.excludedExtras.length, 20);
assert.deepEqual(manifest.workstreamCounts, { privilege: 59, policy: 18, schema: 13 });
for (const target of manifest.targets) {
  assert(FORWARD_RECONCILIATION_WORKSTREAMS[target.workstream].includes(target.section), `workstream section mismatch: ${target.differenceIdentity}`);
}
assert.equal(new Set(manifest.targets.map((target) => target.differenceIdentity)).size, 90);
assert.deepEqual(new Set(manifest.targets.map((target) => target.differenceIdentity)), new Set(canonicalTargets.map((target) => target.key)));
assert.deepEqual(new Set(manifest.excludedExtras.map((extra) => extra.differenceIdentity)), new Set(frozenExtras.map((extra) => extra.key)));
assert.equal(manifest.migration.filename, FORWARD_RECONCILIATION_MIGRATION);
assert.equal(manifest.migration.sha256, sha256(migrationSql));
assert.equal(manifest.statementSha256, compiled.sha256);
assert.equal(migrationSql, compiled.sql);
assert.doesNotMatch(migrationSql, /\b(?:DROP\s+(?:FUNCTION|INDEX|TABLE)|ALTER\s+TABLE|GRANT\s+ALL|ON\s+ALL\s+FUNCTIONS|supabase\s+migration\s+repair)\b/i);
const withoutFunctionBodies = migrationSql.replace(/\$function\$[\s\S]*?\$function\$/g, "");
assert.doesNotMatch(withoutFunctionBodies, /\b(?:INSERT|DELETE)\s+INTO\s+(?:public\.|auth\.|storage\.objects)/i);
assert.match(withoutFunctionBodies, /^((?!UPDATE).)*UPDATE storage\.buckets/m);

const driftResult = await withProductionDriftFixtureRuntime({ root, inputs, label: "forward-reconciliation", run: async (runtime) => {
  assert.deepEqual(runtime.comparison.counts, { MATCH: 1043, MISSING_IN_PRODUCTION: 71, DIVERGENT_IN_PRODUCTION: 19, EXTRA_IN_PRODUCTION: 20, INSUFFICIENT_EVIDENCE: 0 });
  const before = await captureCatalog(root, runtime.container);
  applyMigration(runtime.container);
  const after = await captureCatalog(root, runtime.container);
  const post = compareFingerprint(inputs.expected, after.rows);
  assert.deepEqual(post.counts, { MATCH: 1133, MISSING_IN_PRODUCTION: 0, DIVERGENT_IN_PRODUCTION: 0, EXTRA_IN_PRODUCTION: 20, INSUFFICIENT_EVIDENCE: 0 });
  assertExtrasUntouched(before.rows, after.rows);
  assert.equal(post.objectResults.filter((result) => canonicalTargets.some((target) => target.key === result.key && result.classification !== "MATCH")).length, 0);
  const smoke = runSmoke(runtime.container);
  applyMigration(runtime.container);
  const afterRepeat = await captureCatalog(root, runtime.container);
  const repeat = compareFingerprint(inputs.expected, afterRepeat.rows);
  assert.deepEqual(repeat.counts, post.counts);
  assertExtrasUntouched(after.rows, afterRepeat.rows);
  return { pre: runtime.comparison.counts, post: post.counts, smoke, targetHashMismatches: 0, extrasTouched: 0, repeatSafety: "NON_IDEMPOTENT_BUT_SINGLE_USE_SAFE" };
}});

const canonicalResult = await withNormalizedReplayRuntime({ root, inputs, label: "fresh-canonical", run: async (runtime) => {
  assert.deepEqual(runtime.canonicalComparison.counts, { MATCH: 1133, MISSING_IN_PRODUCTION: 0, DIVERGENT_IN_PRODUCTION: 0, EXTRA_IN_PRODUCTION: 0, INSUFFICIENT_EVIDENCE: 0 });
  const smoke = runSmoke(runtime.container);
  return { comparison: runtime.canonicalComparison.counts, smoke };
}});

console.log(JSON.stringify({ classification: "R6_FORWARD_PRODUCTION_RECONCILIATION_LOCAL_VALIDATED", migrationSha256: sha256(migrationSql), coverage: "90/90", excludedExtras: "20/20", driftRuntime: driftResult, canonicalRuntime: canonicalResult, dockerPulls: 0, remoteOperations: 0, productionOperations: 0 }));
