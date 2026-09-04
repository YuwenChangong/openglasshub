import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const version = "20260904054013";
const migrationPath = path.join(root, "supabase", "migrations", `${version}_forward_reconcile_security_privileges.sql`);
const outputDirectory = path.join(root, "docs", "ops");
const packetPath = path.join(outputDirectory, "production-security-privilege-audit-v1.sql");
const manifestPath = path.join(outputDirectory, "production-security-privilege-audit-v1.json");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function parseTuples(sql, verb, expectedDirectState) {
  const rows = [];
  for (const statement of sql.replace(/--.*$/gm, "").split(";")) {
    const match = new RegExp(`^\\s*${verb}\\s+(.+?)\\s+on\\s+(function|table)\\s+(.+?)\\s+${verb === "revoke" ? "from" : "to"}\\s+(.+?)\\s*$`, "i").exec(statement);
    if (!match) continue;
    const [, privileges, objectKind, objectIdentity, principals] = match;
    for (const privilege of privileges.split(",").map((value) => value.trim().toUpperCase())) {
      for (const principal of principals.split(",").map((value) => value.trim().toLowerCase())) {
        rows.push({ objectKind: objectKind.toUpperCase(), objectIdentity: objectIdentity.replace(/\\s+/g, ""), principal, privilege, expectedDirectState });
      }
    }
  }
  return rows;
}

function packetSql(postconditions, migrationSha256) {
  const values = postconditions.map((entry) => `    (${quote(entry.objectKind)}, ${quote(entry.objectIdentity)}, ${quote(entry.principal)}, ${quote(entry.privilege)}, ${entry.expectedDirectState ? "true" : "false"})`).join(",\n");
  return `BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

WITH expected(object_kind, object_identity, principal, privilege, expected_state) AS (
  VALUES
${values}
),
resolved AS (
  SELECT
    expected.*,
    CASE WHEN expected.object_kind = 'FUNCTION' THEN to_regprocedure(expected.object_identity) ELSE to_regclass(expected.object_identity) END AS object_oid,
    roles.oid AS principal_oid
  FROM expected
  LEFT JOIN pg_catalog.pg_roles AS roles ON roles.rolname = expected.principal
),
observed AS (
  SELECT
    resolved.*,
    CASE
      WHEN resolved.object_kind = 'FUNCTION' THEN COALESCE((
        SELECT bool_or(acl.grantee = CASE WHEN resolved.principal = 'public' THEN 0 ELSE resolved.principal_oid END AND acl.privilege_type = resolved.privilege)
        FROM pg_catalog.pg_proc AS procedures
        CROSS JOIN LATERAL aclexplode(COALESCE(procedures.proacl, '{}'::aclitem[])) AS acl
        WHERE procedures.oid = resolved.object_oid
      ), false)
      ELSE COALESCE((
        SELECT bool_or(acl.grantee = CASE WHEN resolved.principal = 'public' THEN 0 ELSE resolved.principal_oid END AND acl.privilege_type = resolved.privilege)
        FROM pg_catalog.pg_class AS relations
        CROSS JOIN LATERAL aclexplode(COALESCE(relations.relacl, '{}'::aclitem[])) AS acl
        WHERE relations.oid = resolved.object_oid
      ), false)
    END AS observed_direct_state,
    CASE
      WHEN resolved.object_kind = 'FUNCTION' AND resolved.principal = 'public' THEN COALESCE((
        SELECT bool_or(acl.grantee = 0 AND acl.privilege_type = resolved.privilege)
        FROM pg_catalog.pg_proc AS procedures
        CROSS JOIN LATERAL aclexplode(COALESCE(procedures.proacl, acldefault('f', procedures.proowner))) AS acl
        WHERE procedures.oid = resolved.object_oid
      ), false)
      WHEN resolved.object_kind = 'FUNCTION' THEN has_function_privilege(resolved.principal, resolved.object_oid, resolved.privilege)
      WHEN resolved.principal = 'public' THEN COALESCE((
        SELECT bool_or(acl.grantee = 0 AND acl.privilege_type = resolved.privilege)
        FROM pg_catalog.pg_class AS relations
        CROSS JOIN LATERAL aclexplode(COALESCE(relations.relacl, acldefault('r', relations.relowner))) AS acl
        WHERE relations.oid = resolved.object_oid
      ), false)
      ELSE has_table_privilege(resolved.principal, resolved.object_oid, resolved.privilege)
    END AS observed_effective_state,
    CASE
      WHEN resolved.object_kind = 'FUNCTION' THEN COALESCE((SELECT procedures.proowner = resolved.principal_oid FROM pg_catalog.pg_proc AS procedures WHERE procedures.oid = resolved.object_oid), false)
      ELSE COALESCE((SELECT relations.relowner = resolved.principal_oid FROM pg_catalog.pg_class AS relations WHERE relations.oid = resolved.object_oid), false)
    END AS owner_implicit
  FROM resolved
),
history AS (
  SELECT count(*)::text AS row_count, min(version)::text AS version, min(name)::text AS name
  FROM supabase_migrations.schema_migrations
  WHERE version = '${version}'
),
summary AS (
  SELECT count(*)::text AS total, count(*) FILTER (WHERE object_oid IS NOT NULL AND observed_direct_state = expected_state AND observed_effective_state = expected_state)::text AS passed
  FROM observed
)
SELECT
  'POSTCONDITION'::text AS audit_kind,
  'public'::text AS object_schema,
  object_kind,
  object_identity,
  principal,
  privilege,
  expected_state::text AS expected_state,
  observed_direct_state::text AS observed_direct_state,
  observed_effective_state::text AS observed_effective_state,
  (object_oid IS NOT NULL AND observed_direct_state = expected_state AND observed_effective_state = expected_state)::text AS postcondition_pass,
  CASE
    WHEN object_oid IS NULL THEN 'OBJECT_IDENTITY_UNRESOLVED'
    WHEN owner_implicit THEN 'OWNER_IMPLICIT'
    WHEN principal = 'public' AND observed_effective_state THEN 'PUBLIC_INHERITED'
    WHEN observed_direct_state THEN 'DIRECT_GRANT'
    WHEN observed_effective_state THEN 'ROLE_INHERITED'
    ELSE 'NO_PRIVILEGE'
  END AS diagnostic
FROM observed
UNION ALL
SELECT 'AUDIT_POSTCONDITION_TOTAL', NULL, NULL, NULL, NULL, NULL, total, NULL, NULL, NULL, 'MIGRATION_SHA256=${migrationSha256}' FROM summary
UNION ALL
SELECT 'AUDIT_POSTCONDITION_PASS', NULL, NULL, NULL, NULL, NULL, passed, NULL, NULL, NULL, 'EXPECTED=202' FROM summary
UNION ALL
SELECT 'AUDIT_POSTCONDITION_FAIL', NULL, NULL, NULL, NULL, NULL, (total::integer - passed::integer)::text, NULL, NULL, NULL, 'ALREADY_CONVERGED_ONLY_IF_ZERO' FROM summary
UNION ALL
SELECT 'SECURITY_MIGRATION_HISTORY_ROW_COUNT', NULL, NULL, version, NULL, NULL, row_count, NULL, NULL, NULL, coalesce(name, 'ABSENT') FROM history
UNION ALL
SELECT 'CAN_CREATE_COMMENT_TARGET_PUBLIC_EXECUTE', 'public', 'FUNCTION', 'public.can_create_comment_target(uuid,uuid)', 'public', 'EXECUTE', 'false', observed_direct_state::text, observed_effective_state::text, (observed_direct_state = false AND observed_effective_state = false)::text, 'EXACT_SIGNATURE' FROM observed WHERE object_identity = 'public.can_create_comment_target(uuid,uuid)' AND principal = 'public' AND privilege = 'EXECUTE'
UNION ALL
SELECT 'CAN_CREATE_COMMENT_TARGET_ANON_EXECUTE', 'public', 'FUNCTION', 'public.can_create_comment_target(uuid,uuid)', 'anon', 'EXECUTE', 'false', observed_direct_state::text, observed_effective_state::text, (observed_direct_state = false AND observed_effective_state = false)::text, 'EXACT_SIGNATURE' FROM observed WHERE object_identity = 'public.can_create_comment_target(uuid,uuid)' AND principal = 'anon' AND privilege = 'EXECUTE'
UNION ALL
SELECT 'CAN_CREATE_COMMENT_TARGET_AUTHENTICATED_EXECUTE', 'public', 'FUNCTION', 'public.can_create_comment_target(uuid,uuid)', 'authenticated', 'EXECUTE', 'true', observed_direct_state::text, observed_effective_state::text, (observed_direct_state = true AND observed_effective_state = true)::text, 'EXACT_SIGNATURE' FROM observed WHERE object_identity = 'public.can_create_comment_target(uuid,uuid)' AND principal = 'authenticated' AND privilege = 'EXECUTE'
ORDER BY audit_kind, object_kind, object_identity, principal, privilege;

ROLLBACK;
`;
}

const migration = await readFile(migrationPath, "utf8");
const postconditions = [
  ...parseTuples(migration, "revoke", false),
  ...parseTuples(migration, "grant", true),
];
const revokeTupleCount = postconditions.filter((entry) => !entry.expectedDirectState).length;
const grantTupleCount = postconditions.filter((entry) => entry.expectedDirectState).length;
if (revokeTupleCount !== 196 || grantTupleCount !== 6 || new Set(postconditions.map((entry) => JSON.stringify(entry))).size !== 202) {
  throw new Error("AUDIT_PACKET_SOURCE_TUPLE_CONTRACT_INVALID");
}
const migrationSha256 = sha256(migration);
const sql = packetSql(postconditions, migrationSha256);
const manifest = {
  format: "openglass-production-security-privilege-audit-v1",
  securityMigrationVersion: version,
  securityMigrationPath: path.relative(root, migrationPath).replace(/\\\\/g, "/"),
  securityMigrationSha256: migrationSha256,
  sqlSha256: sha256(sql),
  postconditionCounts: { revokeTuples: revokeTupleCount, grantTuples: grantTupleCount, grantStatements: 4, totalTuples: postconditions.length, defaultPrivilegeChanges: 0 },
  postconditions,
  canCreateCommentTarget: { signature: "public.can_create_comment_target(uuid,uuid)", publicExecute: false, anonEffectiveExecute: false, authenticatedEffectiveExecute: true },
  staticValidation: { catalogOnly: true, applicationDataReads: 0, ddl: 0, dml: 0, privilegeMutations: 0, setRole: 0 },
};
await mkdir(outputDirectory, { recursive: true });
await writeFile(packetPath, sql, "utf8");
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ packetPath: path.relative(root, packetPath).split(path.sep).join("/"), manifestPath: path.relative(root, manifestPath).split(path.sep).join("/"), sqlSha256: manifest.sqlSha256, postconditionCounts: manifest.postconditionCounts }));
