import { createHash } from "node:crypto";
import { rowsFromFingerprint, rowKey, sha256 } from "../production-schema-fingerprint-core.mjs";

export const FORWARD_RECONCILIATION_FORMAT = "qa-production-forward-reconciliation-manifest-v1";
export const FORWARD_RECONCILIATION_MIGRATION = "20260807073929_reconcile_production_schema_drift.sql";
export const FORWARD_RECONCILIATION_WORKSTREAMS = Object.freeze({
  privilege: Object.freeze(["function_acl", "grants"]),
  policy: Object.freeze(["policies"]),
  schema: Object.freeze(["functions", "constraints_and_indexes", "migration_configuration", "triggers"]),
});

const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
const hashStatement = (sql) => createHash("sha256").update(sql).digest("hex");

function canonicalFunctionSql(row) {
  const marker = ";body=";
  const offset = row.value.indexOf(marker);
  if (offset < 0) throw new Error("R6_FORWARD_RECONCILIATION_FUNCTION_SOURCE_INVALID");
  return `${row.value.slice(offset + marker.length).trim()};`;
}

function canonicalPolicySql(row) {
  const match = /^permissive=(PERMISSIVE|RESTRICTIVE);roles=([^;]*);using=(.*);with_check=(.*)$/s.exec(row.value);
  if (!match) throw new Error("R6_FORWARD_RECONCILIATION_POLICY_SOURCE_INVALID");
  const [schema, table, policy] = row.identity.split(".");
  const roles = match[2].split(",").filter(Boolean).map(quote).join(", ");
  const clauses = [`CREATE POLICY ${quote(policy)} ON ${quote(schema)}.${quote(table)} AS ${match[1]} FOR ${row.attribute} TO ${roles}`];
  if (match[3]) clauses.push(`USING (${match[3]})`);
  if (match[4]) clauses.push(`WITH CHECK (${match[4]})`);
  return `${clauses.join(" ")};`;
}

function storageBucketSql(row) {
  const fields = Object.fromEntries(row.value.split(";").map((field) => field.split("=", 2)));
  const mimeTypes = fields.allowed_mime_types
    ? `ARRAY[${fields.allowed_mime_types.split(",").map((value) => `'${value.replaceAll("'", "''")}'`).join(", ")}]`
    : "NULL";
  return `UPDATE storage.buckets SET public = ${fields.public}, file_size_limit = ${fields.file_size_limit || "NULL"}, allowed_mime_types = ${mimeTypes} WHERE id = '${row.identity.replaceAll("'", "''")}';`;
}

function expectedRoleGrants(aclRows) {
  if (aclRows.some((row) => row.attribute === "PUBLIC_execute" && row.value === "true")) return ["PUBLIC"];
  return aclRows
    .filter((row) => row.value === "true")
    .map((row) => row.attribute.replace(/_execute$/, ""))
    .filter((role) => role !== "postgres");
}

function addStatement(statements, targetStatements, id, sql, targetKeys) {
  const statement = Object.freeze({ id, sql, sha256: hashStatement(sql) });
  statements.push(statement);
  for (const key of targetKeys) {
    const mapped = targetStatements.get(key) ?? [];
    mapped.push(statement.id);
    targetStatements.set(key, mapped);
  }
}

export function canonicalOwnedDifferences(inputs) {
  return inputs.comparison.objectResults.filter((entry) => entry.classification === "MISSING_IN_PRODUCTION" || entry.classification === "DIVERGENT_IN_PRODUCTION");
}

export function extraDifferences(inputs) {
  return inputs.comparison.objectResults.filter((entry) => entry.classification === "EXTRA_IN_PRODUCTION");
}

function workstreamForSection(section) {
  for (const [workstream, sections] of Object.entries(FORWARD_RECONCILIATION_WORKSTREAMS)) {
    if (sections.includes(section)) return workstream;
  }
  throw new Error("R6_FORWARD_RECONCILIATION_WORKSTREAM_UNMAPPED");
}

export function compileForwardReconciliation(inputs) {
  const targets = canonicalOwnedDifferences(inputs);
  if (targets.length !== 90) throw new Error("R6_FORWARD_RECONCILIATION_TARGET_COUNT_INVALID");
  const expectedByKey = inputs.expectedByKey;
  const byPrefix = (prefix) => targets.filter((entry) => entry.key.startsWith(prefix));
  const statements = [];
  const targetStatements = new Map();

  const functionEntries = byPrefix("functions|");
  const functionByName = new Map(functionEntries.map((entry) => [expectedByKey.get(entry.key).identity.split("(")[0], entry]));
  const remainingFunctions = [...functionEntries];
  const orderedFunctions = [];
  while (remainingFunctions.length) {
    const nextIndex = remainingFunctions.findIndex((entry) => {
      const row = expectedByKey.get(entry.key);
      const functionName = row.identity.split("(")[0];
      const dependencies = [...canonicalFunctionSql(row).matchAll(/\bpublic\.([a-z_][a-z0-9_]*)\s*\(/gi)].map((match) => match[1]).filter((dependency) => dependency !== functionName);
      return dependencies.every((dependency) => !functionByName.has(dependency) || orderedFunctions.includes(functionByName.get(dependency)));
    });
    if (nextIndex < 0) throw new Error("R6_FORWARD_RECONCILIATION_FUNCTION_DEPENDENCY_CYCLE");
    orderedFunctions.push(remainingFunctions.splice(nextIndex, 1)[0]);
  }
  for (const entry of orderedFunctions) {
    const row = expectedByKey.get(entry.key);
    const sql = canonicalFunctionSql(row);
    addStatement(statements, targetStatements, `function:${row.identity}`, sql, [entry.key]);
    addStatement(statements, targetStatements, `function-owner:${row.identity}`, `ALTER FUNCTION public.${row.identity} OWNER TO postgres;`, [entry.key]);
  }

  for (const entry of byPrefix("constraints_and_indexes|")) {
    const row = expectedByKey.get(entry.key);
    addStatement(statements, targetStatements, `index:${row.identity}`, `${row.value.replace(/^CREATE INDEX /, "CREATE INDEX IF NOT EXISTS ")};`, [entry.key]);
  }

  for (const entry of byPrefix("migration_configuration|")) {
    const row = expectedByKey.get(entry.key);
    addStatement(statements, targetStatements, `storage:${row.identity}`, storageBucketSql(row), [entry.key]);
  }

  for (const entry of byPrefix("policies|")) {
    const row = expectedByKey.get(entry.key);
    const [schema, table, policy] = row.identity.split(".");
    addStatement(statements, targetStatements, `policy-drop:${row.identity}`, `DROP POLICY IF EXISTS ${quote(policy)} ON ${quote(schema)}.${quote(table)};`, [entry.key]);
    addStatement(statements, targetStatements, `policy-create:${row.identity}`, canonicalPolicySql(row), [entry.key]);
  }

  for (const entry of byPrefix("triggers|")) {
    const row = expectedByKey.get(entry.key);
    const [schema, table, trigger] = row.identity.split(".");
    addStatement(statements, targetStatements, `trigger-drop:${row.identity}`, `DROP TRIGGER IF EXISTS ${quote(trigger)} ON ${quote(schema)}.${quote(table)};`, [entry.key]);
    addStatement(statements, targetStatements, `trigger-create:${row.identity}`, `${row.value};`, [entry.key]);
  }

  const aclEntries = byPrefix("function_acl|");
  const aclGroups = new Map();
  for (const entry of aclEntries) {
    const row = expectedByKey.get(entry.key);
    const rows = aclGroups.get(row.identity) ?? [];
    rows.push({ entry, row });
    aclGroups.set(row.identity, rows);
  }
  for (const [identity, rows] of aclGroups) {
    const keys = rows.map(({ entry }) => entry.key);
    addStatement(statements, targetStatements, `function-acl-reset:${identity}`, `REVOKE ALL ON FUNCTION public.${identity} FROM PUBLIC, anon, authenticated, service_role;`, keys);
    for (const role of expectedRoleGrants(rows.map(({ row }) => row))) {
      addStatement(statements, targetStatements, `function-acl-grant:${identity}:${role}`, `GRANT EXECUTE ON FUNCTION public.${identity} TO ${role === "PUBLIC" ? "PUBLIC" : quote(role)};`, keys.filter((key) => expectedByKey.get(key).attribute === `${role}_execute`));
    }
  }

  const grants = byPrefix("grants|");
  for (const entry of grants) {
    const row = expectedByKey.get(entry.key);
    const [role, privilege] = row.attribute.split(":", 2);
    const roleSql = role === "PUBLIC" ? "PUBLIC" : quote(role);
    addStatement(statements, targetStatements, `grant:${row.identity}:${role}:${privilege}`, `GRANT ${privilege} ON FUNCTION public.${row.identity} TO ${roleSql};`, [entry.key]);
  }

  const uncovered = targets.filter((entry) => !(targetStatements.get(entry.key)?.length));
  if (uncovered.length) throw new Error("R6_FORWARD_RECONCILIATION_TARGET_UNMAPPED");
  const sql = `${statements.map((statement) => statement.sql).join("\n\n")}\n`;
  return Object.freeze({ targets, statements: Object.freeze(statements), targetStatements, sql, sha256: sha256(sql) });
}

export function buildForwardReconciliationManifest(inputs, compiled, { startingCommit, migrationFilename, migrationSha256 }) {
  const expectedRows = inputs.expectedByKey;
  const observedRows = inputs.rawByKey;
  const expectedEntries = new Map(rowsFromFingerprint(inputs.expected).map((row) => [rowKey(row), row]));
  const sourceEntries = new Map(inputs.expected.objects.map((entry) => [rowKey({
    section: entry.objectType === "policy" ? "policies" : entry.objectType === "storage_bucket" ? "migration_configuration" : entry.objectType === "index" ? "constraints_and_indexes" : entry.objectType === "function" && entry.attribute.endsWith("_execute") ? "function_acl" : entry.objectType.endsWith("grant") ? "grants" : `${entry.objectType}s`,
    object_type: entry.objectType, schema_name: entry.schema, object_name: entry.name, identity: entry.identity, attribute: entry.attribute,
  }), entry]));
  const targets = compiled.targets.map((difference) => {
    const expected = expectedRows.get(difference.key) ?? expectedEntries.get(difference.key);
    const observed = observedRows.get(difference.key) ?? null;
    const source = sourceEntries.get(difference.key) ?? null;
    const section = expected?.section ?? observed?.section;
    return {
      differenceIdentity: difference.key,
      section,
      workstream: workstreamForSection(section),
      classification: difference.classification,
      canonicalOwner: source?.sourceMigrations?.at(-1) ?? "canonical-head",
      canonicalEvolutionChain: source?.sourceMigrations ?? [],
      observedStateHash: observed?.definition_hash || null,
      expectedStateHash: expected?.definition_hash || null,
      reconciliationStatementIds: compiled.targetStatements.get(difference.key),
      postcondition: "CANONICAL_EXPECTED_HASH_MATCH",
    };
  });
  const extras = extraDifferences(inputs).map((difference) => ({ differenceIdentity: difference.key, classification: difference.classification, exclusion: "UNEXPECTED_APPLICATION_OR_HISTORICAL_OBJECT_REQUIRES_MANUAL_REVIEW" }));
  const workstreamCounts = Object.fromEntries(Object.keys(FORWARD_RECONCILIATION_WORKSTREAMS).map((workstream) => [
    workstream,
    targets.filter((target) => target.workstream === workstream).length,
  ]));
  if (workstreamCounts.privilege !== 59 || workstreamCounts.policy !== 18 || workstreamCounts.schema !== 13) {
    throw new Error("R6_FORWARD_RECONCILIATION_WORKSTREAM_COVERAGE_INVALID");
  }
  return Object.freeze({
    format: FORWARD_RECONCILIATION_FORMAT,
    startingCommit,
    fixtureImplementationCommit: startingCommit,
    frozenEvidence: inputs.frozenEvidence ?? inputs.sources,
    migration: { identity: migrationFilename.slice(0, 14), filename: migrationFilename, sha256: migrationSha256 },
    targetDifferenceCount: targets.length,
    excludedExtraCount: extras.length,
    workstreamCounts,
    targets,
    excludedExtras: extras,
    statementCount: compiled.statements.length,
    statementSha256: compiled.sha256,
  });
}
