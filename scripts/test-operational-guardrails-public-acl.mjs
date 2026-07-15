import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { REQUIRED_SECTIONS } from "./operational-guardrails-preflight-core.mjs";

const root = process.cwd();
const containers = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" })
  .split(/\r?\n/).filter((name) => name.startsWith("supabase_db_local-supabase-normalized-replay-"));
assert.equal(containers.length, 1, "LOCAL_DOCKER_ONLY requires one disposable normalized replay database");
const psql = (input) => {
  const result = spawnSync("docker", ["exec", "-i", containers[0], "psql", "-X", "-qAt", "-F", "\t", "-U", "postgres", "-d", "postgres"], { input, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
};

assert.equal(psql("SELECT count(*) FROM pg_roles WHERE rolname = 'PUBLIC';"), "0", "PUBLIC must remain absent from pg_roles");
assert.equal(psql("SELECT CASE WHEN policy_role.role_oid = 0 THEN 'PUBLIC' ELSE 'NOT_PUBLIC' END FROM unnest(ARRAY[0::oid]) AS policy_role(role_oid);"), "PUBLIC", "policy role OID 0 must render as PUBLIC");

const sql = await readFile(path.join(root, "docs", "ops", "reconciliation", "operational-guardrails-production-preflight-one-shot.sql"), "utf8");
const output = psql(sql);
const rows = output.split(/\r?\n/).filter(Boolean).map((line) => line.split("\t"));
assert(rows.length > 0, "the packet must return one result set with rows");
for (const row of rows) assert.equal(row.length, 10, `unified packet row must have ten columns: ${row.join("|")}`);
assert.deepEqual(new Set(rows.map((row) => row[2])), new Set(REQUIRED_SECTIONS));
const aclRow = rows.find((row) => row[2] === "attempts_table_acl" && row[6] === "acl");
assert(aclRow, "ACL section must contain its catalog matrix");
const acl = JSON.parse(aclRow[7]);
for (const role of ["PUBLIC", "anon", "authenticated", "service_role", "postgres"]) {
  assert.equal(typeof acl[role]?.role_exists, "boolean", `${role} must have explicit catalog evidence`);
  for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) assert.equal(typeof acl[role]?.[privilege], "boolean", `${role} ${privilege} must be catalog-derived`);
}

assert.equal(execFileSync("git", ["diff", "--name-only", "HEAD", "--", "supabase/migrations", "src"], { cwd: root, encoding: "utf8" }).trim(), "", "canonical migrations and runtime files must remain unchanged");
console.log(JSON.stringify({ localDockerOnly: true, publicPgRoleCount: 0, packetRows: rows.length, requiredSections: REQUIRED_SECTIONS.length, oneResultSet: true, noMutation: true }));
