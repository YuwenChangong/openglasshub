import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  OUTPUT_COLUMNS,
  REQUIRED_SECTIONS,
  parseCsv,
  serializeCsv,
  validatePacketRows,
} from "./can-access-public-circle-preflight-one-shot-core.mjs";

const root = process.cwd();
const sqlPath = path.join(root, "docs", "ops", "reconciliation", "can-access-public-circle-preflight-one-shot.sql");
const sql = await readFile(sqlPath, "utf8");
const uncommented = sql.replace(/--[^\n]*/g, "");

assert.equal((uncommented.match(/;/g) ?? []).length, 1, "the one-shot packet must have exactly one SQL statement and result set");
assert.doesNotMatch(uncommented, /\b(?:CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|MERGE|TRUNCATE|COPY|DO|CALL|EXECUTE)\b/i, "the one-shot packet must remain read-only");
assert.doesNotMatch(uncommented, /(?:auth\.users|vault|current_setting|schema_migrations|storage\.objects|\bposts\b|\bcomments\b|\bpost_media\b)/i, "the packet must not inspect secrets, auth users, migration history, or business relations");
assert.match(sql, /to_regprocedure\('public\.can_access_public_circle\(uuid\)'\)/);
assert.match(sql, /to_regclass\('public\.circles'\)/);
assert.match(sql, /expected_section_count', '7'/);
for (const section of REQUIRED_SECTIONS) assert.match(sql, new RegExp(`'${section}'`), `one-shot packet omits ${section}`);
assert.match(sql, /WHERE NOT EXISTS \(SELECT 1 FROM function_target\)/, "missing function must have a sentinel");
assert.match(sql, /WHERE NOT EXISTS \(SELECT 1 FROM circles_constraints\)/, "missing constraints must have a sentinel");
assert.match(sql, /LEFT JOIN required_roles/, "missing roles must have sentinels");

const containers = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter((name) => name.startsWith("supabase_db_local-supabase-normalized-replay-"));
assert.equal(containers.length, 1, "LOCAL_DOCKER_ONLY requires one disposable normalized replay database container");
const runQuery = (prefix = "", suffix = "") => execFileSync(
  "docker",
  ["exec", "-i", containers[0], "psql", "-X", "-q", "--csv", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"],
  { input: prefix + sql + suffix, encoding: "utf8" },
);

const localRows = parseCsv(runQuery());
assert.deepEqual(Object.keys(localRows[0]), OUTPUT_COLUMNS);
const localResult = validatePacketRows(localRows);
assert.equal(localResult.prerequisiteProposalEligible, false, "the normalized local baseline has the function and cannot impersonate the production-missing prerequisite state");

const clone = (rows) => rows.map((row) => ({ ...row }));
const missingFunctionFixture = clone(localRows)
  .filter((row) => row.section !== "function_metadata_acl")
  .map((row) => {
    if (row.section === "function_signature_overloads" && row.attribute === "exact_signature") return { ...row, value: null, evidence_status: "MISSING" };
    if (row.section === "function_signature_overloads" && row.attribute === "overload_count") return { ...row, value: "0", evidence_status: "MISSING" };
    return row;
  });
missingFunctionFixture.push({
  packet_version: localRows[0].packet_version,
  section_order: "1",
  section: "function_metadata_acl",
  row_key: "public.can_access_public_circle(uuid)",
  object_schema: "public",
  object_name: "can_access_public_circle",
  attribute: "present",
  value: "false",
  evidence_status: "MISSING",
});
const completeFixtureRows = parseCsv(serializeCsv(missingFunctionFixture));
const completeFixture = validatePacketRows(completeFixtureRows);
assert.equal(completeFixture.dependencyClassification["public.can_access_public_circle(uuid)"], "MISSING");
assert.equal(completeFixture.prerequisiteProposalEligible, true, "a complete compatible packet with an explicit missing function must be proposal-eligible");

assert.throws(
  () => validatePacketRows(parseCsv(serializeCsv(completeFixtureRows.filter((row) => row.section !== "circles_policies")))),
  /(?:seven required evidence sections|truncated: required section circles_policies is absent)/,
  "missing Dashboard sections must fail closed",
);
assert.throws(() => parseCsv("packet_version,section\nunterminated,\"quoted"), /ends inside a quoted value/, "malformed CSV must fail closed");

const missingConstraints = completeFixtureRows.map((row) => row.section === "circles_constraints" ? {
  ...row,
  row_key: "none",
  attribute: "present",
  value: null,
  evidence_status: "MISSING",
} : row).filter((row, index, rows) => row.section !== "circles_constraints" || index === rows.findIndex((candidate) => candidate.section === "circles_constraints"));
assert.equal(validatePacketRows(missingConstraints).dependencyClassification["public.circles constraints"], "MISSING");

const missingRole = completeFixtureRows.map((row) => row.section === "required_roles" && row.attribute === "authenticated" ? {
  ...row,
  value: null,
  evidence_status: "MISSING",
} : row);
assert.equal(validatePacketRows(missingRole).dependencyClassification["role:authenticated"], "MISSING");

const missingFunctionRows = parseCsv(runQuery("BEGIN;\nDROP FUNCTION public.can_access_public_circle(uuid) CASCADE;\n", "\nROLLBACK;\n"));
const missingFunctionResult = validatePacketRows(missingFunctionRows);
assert.equal(missingFunctionResult.dependencyClassification["public.can_access_public_circle(uuid)"], "MISSING", "the local missing-function state must retain explicit function evidence");
assert.equal(
  execFileSync("docker", ["exec", "-i", containers[0], "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { input: "SELECT to_regprocedure('public.can_access_public_circle(uuid)') IS NOT NULL;", encoding: "utf8" }).trim(),
  "t",
  "the missing-function fixture simulation must roll back",
);

console.log(JSON.stringify({
  oneResultSet: true,
  sectionCount: REQUIRED_SECTIONS.length,
  completeFixturePasses: true,
  truncatedCsvFailsClosed: true,
  missingFunctionSentinel: true,
  missingConstraintAndRoleSentinels: true,
  localDockerOnly: true,
  realProductionOperations: 0,
}));
