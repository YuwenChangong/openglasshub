import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const packet = await readFile(path.join(root, "docs", "ops", "reconciliation", "operational-guardrails-authenticated-privilege-supplemental-preflight.sql"), "utf8");
const containers = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter((name) => name.startsWith("supabase_db_local-supabase-normalized-replay-"));

assert.equal(containers.length, 1, "LOCAL_DOCKER_ONLY requires exactly one normalized replay PostgreSQL container");
assert.match(packet, /^--[^\n]*\n--[^\n]*\nBEGIN TRANSACTION READ ONLY;/);
assert.match(packet, /\nROLLBACK;\s*$/);
assert.doesNotMatch(packet.replace(/--[^\n]*/g, ""), /(?:^|\n)\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE)\b/im);
assert.doesNotMatch(packet, /from\s+public\.forum_upload_attempts\b/i, "the packet must not select application attempt rows");

const container = containers[0];
const database = "openglass_w6_privilege_supplement_sim";
const parentRole = "w6_privilege_parent";
const grandparentRole = "w6_privilege_grandparent";
const psql = (input, databaseName = database) => {
  const result = spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-At", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", databaseName], {
    input,
    encoding: "utf8",
  });
  return result;
};
const mustRun = (input, databaseName) => {
  const result = psql(input, databaseName);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
};

try {
  mustRun(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${parentRole}') THEN
        EXECUTE 'REVOKE ${parentRole} FROM authenticated';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${grandparentRole}')
        AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${parentRole}') THEN
        EXECUTE 'REVOKE ${grandparentRole} FROM ${parentRole}';
      END IF;
    END $$;
    DROP ROLE IF EXISTS ${grandparentRole};
    DROP ROLE IF EXISTS ${parentRole};
    DROP DATABASE IF EXISTS ${database};
    CREATE ROLE ${parentRole} NOLOGIN INHERIT;
    CREATE ROLE ${grandparentRole} NOLOGIN INHERIT;
    GRANT ${parentRole} TO authenticated;
    GRANT ${grandparentRole} TO ${parentRole};
    CREATE DATABASE ${database};
  `, "postgres");

  mustRun(`
    CREATE SEQUENCE public.w6_privilege_supplement_attempt_id_seq;
    CREATE TABLE public.forum_upload_attempts (
      id bigint PRIMARY KEY DEFAULT nextval('public.w6_privilege_supplement_attempt_id_seq'::regclass),
      purpose text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE public.forum_upload_attempts ENABLE ROW LEVEL SECURITY;
    ALTER SEQUENCE public.w6_privilege_supplement_attempt_id_seq OWNED BY public.forum_upload_attempts.id;
    REVOKE ALL ON SCHEMA public FROM PUBLIC;
    REVOKE ALL ON SEQUENCE public.w6_privilege_supplement_attempt_id_seq FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO ${parentRole};
    GRANT USAGE ON SEQUENCE public.w6_privilege_supplement_attempt_id_seq TO ${parentRole};
    GRANT SELECT ON SEQUENCE public.w6_privilege_supplement_attempt_id_seq TO ${grandparentRole};
  `);

  const legacy = psql(`
    \\set VERBOSITY verbose
    WITH RECURSIVE target_roles AS (
      SELECT role_name, role_ref.oid
      FROM (VALUES ('authenticated'::text)) AS target(role_name)
      JOIN pg_roles role_ref ON role_ref.rolname = target.role_name
    ), role_closure AS (
      SELECT role_name AS root_role, oid AS role_oid, role_name AS effective_role, 0 AS depth, ARRAY[oid] AS path
      FROM target_roles
      UNION ALL
      SELECT closure.root_role, parent.oid, parent.rolname, closure.depth + 1, closure.path || parent.oid
      FROM role_closure closure
      JOIN pg_auth_members membership ON membership.member = closure.role_oid
      JOIN pg_roles parent ON parent.oid = membership.roleid
      WHERE NOT parent.oid = ANY(closure.path)
    )
    SELECT * FROM role_closure;
  `);
  assert.notEqual(legacy.status, 0, "the legacy mixed-collation recursive CTE must fail");
  assert.match(`${legacy.stderr}\n${legacy.stdout}`, /42P21/, "the legacy query must reproduce PostgreSQL collation error 42P21");

  const result = psql(packet);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(`${result.stderr}\n${result.stdout}`, /42P21/);
  const outputLines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  const rows = outputLines.filter((line) => line.split("\t").length === 10).map((line) => line.split("\t"));
  const commandTags = outputLines.filter((line) => line.split("\t").length !== 10);
  assert(commandTags.every((tag) => /^(?:BEGIN|ROLLBACK)$/.test(tag)), `unexpected packet output: ${commandTags.join(", ")}`);
  assert(commandTags.includes("ROLLBACK"), "the packet must reach its final ROLLBACK");
  assert(rows.length > 0, "the corrected packet must return catalog evidence");
  assert(rows.every((row) => row.length === 10), "the corrected packet must preserve its ten-column contract");
  const sections = new Set(rows.map((row) => row[2]));
  assert.deepEqual([...sections].sort(), [
    "effective_schema_privileges",
    "effective_sequence_privileges",
    "packet_manifest",
    "referenced_sequence_catalog",
    "role_membership_topology",
    "schema_acl_catalog",
    "sequence_acl_catalog",
    "target_role_catalog",
  ]);
  const topology = rows
    .filter((row) => row[2] === "role_membership_topology")
    .map((row) => JSON.parse(row[7]));
  assert(topology.some((edge) => edge.root_role === "authenticated" && edge.parent_role === parentRole && edge.membership_depth === 1 && edge.membership_kind === "DIRECT"));
  assert(topology.some((edge) => edge.root_role === "authenticated" && edge.parent_role === grandparentRole && edge.membership_depth === 2 && edge.membership_kind === "TRANSITIVE"));
  assert.equal(new Set(rows.map((row) => `${row[2]}|${row[3]}|${row[6]}`)).size, rows.length, "the packet must not emit duplicate report rows");
} finally {
  try {
    mustRun(`DROP DATABASE IF EXISTS ${database};`, "postgres");
    mustRun(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${parentRole}') THEN
          EXECUTE 'REVOKE ${parentRole} FROM authenticated';
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${grandparentRole}')
          AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${parentRole}') THEN
          EXECUTE 'REVOKE ${grandparentRole} FROM ${parentRole}';
        END IF;
      END $$;
      DROP ROLE IF EXISTS ${grandparentRole};
      DROP ROLE IF EXISTS ${parentRole};
    `, "postgres");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

console.log(JSON.stringify({ localDockerOnly: true, legacyCollationFailureReproduced: true, correctedPacketRolledBack: true, productionOperations: 0 }));
