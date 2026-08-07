import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { compareFingerprint, parseExport } from "../compare-production-schema-fingerprint.mjs";
import { buildFingerprint, loadPacketSql, migrationSourceIndex, parseCsv, rowKey, rowsFromFingerprint, sha256 } from "../production-schema-fingerprint-core.mjs";

export const FIXTURE_FORMAT = "qa-production-drift-structural-fixture-manifest-v1";
export const STARTING_COMMIT = "df6cd8822449af7599003e09ea60722ccef5310b";
export const FROZEN_HASHES = Object.freeze({
  rawExport: "0062911093a992542d62ea81d73a419a88e99bf24d2eaeafdaf578694f01cdf7",
  catalogFingerprint: "199e0214a2d2506dbde810f5a47d2d507a0b71486ef2e0d4de3615dcf4ff6d14",
  schemaComparison: "5af0a636460764012d9f444ae5ee1207c1469f7f614dfe40bb2b4f9be6199956",
  driftSummary: "c91c3956adedc53a22cdd2d7f876836d4386c7b759fdd193ff96ae140619a0f6",
  reconciliationSummary: "9c7f24fc6a6b02c4bd84cfda4ff1eda54e056b9d555a3faff17228361661bd94",
  reconciliationObjectMap: "e3781be47528dff28242faa4d6f9b8e5d6a42cddde4002e95a28602d3e35ce07",
  reconciliationMigrationMap: "c0289bd46c986854e6827c56e783ec7bf4500ae5c2094f5ed0a1666b768d00b6",
});

const rawExportPath = "C:/Users/1/Downloads/Supabase Snippet Untitled query (2).csv";
const fingerprintRoot = "C:/Users/1/OpenGlassHub-R6-Proof/r6-production-fingerprint-offline-af3ee7c9-b8e116db-74cf-4235-8bdd-805e5b456036";
const reconciliationRoot = "C:/Users/1/OpenGlassHub-R6-Proof/r6-production-drift-reconciliation-af3ee7c9-d668abdb-52d8-477e-9d67-8b49ec82173b";
const hashBytes = (value) => createHash("sha256").update(value).digest("hex");

function docker(args, input) {
  return execFileSync("docker", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });
}
function node(root, args) {
  return execFileSync(process.execPath, args, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}
async function assertFileHash(label, filename, expected) {
  const actual = hashBytes(await readFile(filename));
  if (actual !== expected) throw new Error(`R6_PRODUCTION_DRIFT_FIXTURE_${label}_HASH_MISMATCH`);
}
function sectionFor(entry) {
  if (entry.objectType === "policy") return "policies";
  if (entry.objectType === "function" && entry.attribute.endsWith("_execute")) return "function_acl";
  if (entry.objectType.endsWith("grant")) return "grants";
  if (entry.objectType === "constraint" || entry.objectType === "index") return "constraints_and_indexes";
  if (entry.objectType === "storage_bucket") return "migration_configuration";
  return `${entry.objectType}s`;
}
function quote(value) { return `"${String(value).replaceAll('"', '""')}"`; }
function sourceForDifference(inputs, difference) {
  const observed = inputs.rawByKey.get(difference.key);
  const expected = inputs.expectedByKey.get(difference.key);
  if (difference.classification === "MISSING_IN_PRODUCTION" ? !expected : !observed) throw new Error("R6_PRODUCTION_DRIFT_FIXTURE_UNRECONSTRUCTIBLE_DIFFERENCE");
  return { observed, expected };
}
function functionDefinitionSql(row, sourceFunctions) {
  const source = sourceFunctions.get(row.identity);
  if (source) return source;
  const value = row.value;
  const marker = ";body=";
  const offset = value.indexOf(marker);
  if (offset < 0) throw new Error("R6_PRODUCTION_DRIFT_FIXTURE_FUNCTION_BODY_INVALID");
  return `${value.slice(offset + marker.length).trim()};`;
}
function policyDefinitionSql(row) {
  const match = /^permissive=(PERMISSIVE|RESTRICTIVE);roles=([^;]*);using=(.*);with_check=(.*)$/s.exec(row.value);
  if (!match) throw new Error("R6_PRODUCTION_DRIFT_FIXTURE_POLICY_VALUE_INVALID");
  const [schema, table, policy] = row.identity.split(".");
  const roles = match[2].split(",").filter(Boolean).map(quote).join(", ");
  const clauses = [`CREATE POLICY ${quote(policy)} ON ${quote(schema)}.${quote(table)} AS ${match[1]} FOR ${row.attribute} TO ${roles}`];
  if (match[3]) clauses.push(`USING (${match[3]})`);
  if (match[4]) clauses.push(`WITH CHECK (${match[4]})`);
  return `${clauses.join(" ")};`;
}
function grantSql(row, allowed) {
  const [role, privilege] = row.attribute.split(":", 2);
  const object = row.object_type === "table_grant" ? `TABLE ${row.identity}` : `FUNCTION public.${row.identity}`;
  return `${allowed ? "GRANT" : "REVOKE"} ${privilege} ON ${object} ${allowed ? "TO" : "FROM"} ${role === "PUBLIC" ? "PUBLIC" : quote(role)};`;
}

export async function loadFrozenDriftInputs(root) {
  const sources = {
    rawExport: rawExportPath,
    catalogFingerprint: path.join(fingerprintRoot, "production-catalog-fingerprint.json"),
    schemaComparison: path.join(fingerprintRoot, "production-schema-comparison.json"),
    driftSummary: path.join(fingerprintRoot, "production-schema-drift-summary.json"),
    reconciliationSummary: path.join(reconciliationRoot, "production-drift-reconciliation-summary.json"),
    reconciliationObjectMap: path.join(reconciliationRoot, "production-drift-object-map.json"),
    reconciliationMigrationMap: path.join(reconciliationRoot, "production-drift-migration-map.json"),
  };
  for (const [label, filename] of Object.entries(sources)) await assertFileHash(label, filename, FROZEN_HASHES[label]);
  const [expectedText, rawText, frozenText, objectMapText, rateLimitProposal] = await Promise.all([
    readFile(path.join(root, "tests", "fixtures", "production-schema-expected-fingerprint.json"), "utf8"),
    readFile(sources.rawExport, "utf8"), readFile(sources.schemaComparison, "utf8"), readFile(sources.reconciliationObjectMap, "utf8"),
    readFile(path.join(root, "docs", "ops", "reconciliation", "operational-guardrails-rate-limit-r2-unexecuted-proposal.sql"), "utf8"),
  ]);
  const expected = JSON.parse(expectedText);
  const rawRows = parseExport(rawText, sources.rawExport);
  const frozenComparison = JSON.parse(frozenText);
  const comparison = compareFingerprint(expected, rawRows);
  if (JSON.stringify(comparison.objectResults) !== JSON.stringify(frozenComparison.objectResults)) throw new Error("R6_PRODUCTION_DRIFT_FIXTURE_FROZEN_COMPARISON_MISMATCH");
  const expectedRows = rowsFromFingerprint(expected);
  const functionStart = rateLimitProposal.indexOf("CREATE FUNCTION public.consume_forum_rate_limit(");
  const functionEnd = rateLimitProposal.indexOf("ALTER FUNCTION public.consume_forum_rate_limit", functionStart);
  if (functionStart < 0 || functionEnd < functionStart) throw new Error("R6_PRODUCTION_DRIFT_FIXTURE_RATE_LIMIT_SOURCE_MISSING");
  const functionSourceSql = rateLimitProposal.slice(functionStart, functionEnd).trim();
  const rateLimitKey = "functions|function|public|consume_forum_rate_limit|consume_forum_rate_limit(uuid,text,text,bigint)|definition";
  const rawRateLimit = rawRows.find((row) => rowKey(row) === rateLimitKey);
  if (!rawRateLimit || !rawRateLimit.value.includes("-- Every current invocation")) throw new Error("R6_PRODUCTION_DRIFT_FIXTURE_RATE_LIMIT_SOURCE_NOT_REQUIRED");
  return Object.freeze({
    expected, rawRows, comparison, frozenComparison, objectMap: JSON.parse(objectMapText), sources,
    expectedByKey: new Map(expectedRows.map((row) => [rowKey(row), row])), rawByKey: new Map(rawRows.map((row) => [rowKey(row), row])),
    sourceFunctions: new Map([[rawRateLimit.identity, functionSourceSql]]),
  });
}

export function buildFixtureManifest(inputs) {
  const differences = inputs.comparison.objectResults.filter((entry) => entry.classification !== "MATCH");
  for (const difference of differences) sourceForDifference(inputs, difference);
  return Object.freeze({
    format: FIXTURE_FORMAT, startingCommit: STARTING_COMMIT, frozenEvidence: FROZEN_HASHES,
    expectedCounts: inputs.comparison.counts, expectedHardBlockers: inputs.comparison.hardBlockers.length,
    differenceCount: differences.length, canonicalOwnedDifferenceCount: 90, manualReviewExtraCount: 20,
    normalizedReplay: { testOnly: true, formalLegalEvidence: false, formalMigrationHistoryEvidence: false, contractVersion: "openglass-normalized-replay-task-v1" },
    structuralMutationsOnly: ["FUNCTION", "FUNCTION_ACL", "GRANT", "POLICY", "TRIGGER", "INDEX", "STORAGE_BUCKET_CONFIGURATION"],
  });
}

export function compileStructuralDriftFixture(inputs) {
  const differences = inputs.comparison.objectResults.filter((entry) => entry.classification !== "MATCH");
  const byPrefix = (prefix) => differences.filter((entry) => entry.key.startsWith(prefix));
  const statements = [];
  const policies = byPrefix("policies|");
  for (const difference of policies) {
    const { observed, expected } = sourceForDifference(inputs, difference); const source = observed ?? expected;
    const [schema, table, policy] = source.identity.split(".");
    statements.push(`DROP POLICY IF EXISTS ${quote(policy)} ON ${quote(schema)}.${quote(table)};`);
  }
  for (const difference of policies.filter((entry) => entry.classification !== "MISSING_IN_PRODUCTION")) statements.push(policyDefinitionSql(sourceForDifference(inputs, difference).observed));

  const functions = byPrefix("functions|");
  const removedFunctionIdentities = new Set(functions.filter((entry) => entry.classification === "MISSING_IN_PRODUCTION").map((entry) => sourceForDifference(inputs, entry).expected.identity));
  for (const difference of functions.filter((entry) => entry.classification === "MISSING_IN_PRODUCTION")) statements.push(`DROP FUNCTION IF EXISTS public.${sourceForDifference(inputs, difference).expected.identity};`);
  for (const difference of functions.filter((entry) => entry.classification !== "MISSING_IN_PRODUCTION")) statements.push(functionDefinitionSql(sourceForDifference(inputs, difference).observed, inputs.sourceFunctions));

  for (const difference of byPrefix("triggers|")) {
    const { observed, expected } = sourceForDifference(inputs, difference); const source = observed ?? expected;
    const [schema, table, trigger] = source.identity.split(".");
    statements.push(`DROP TRIGGER IF EXISTS ${quote(trigger)} ON ${quote(schema)}.${quote(table)};`);
    if (observed) statements.push(`${observed.value};`);
  }
  for (const difference of byPrefix("constraints_and_indexes|")) {
    const identity = sourceForDifference(inputs, difference).expected.identity.split(".");
    if (identity.length !== 3) throw new Error("R6_PRODUCTION_DRIFT_FIXTURE_INDEX_IDENTITY_INVALID");
    statements.push(`DROP INDEX IF EXISTS ${quote(identity[0])}.${quote(identity[2])};`);
  }
  for (const difference of byPrefix("migration_configuration|")) {
    const value = sourceForDifference(inputs, difference).observed.value;
    const fields = Object.fromEntries(value.split(";").map((field) => field.split("=", 2)));
    const types = fields.allowed_mime_types ? `ARRAY[${fields.allowed_mime_types.split(",").map((item) => `'${item.replaceAll("'", "''")}'`).join(", ")}]` : "NULL";
    statements.push(`UPDATE storage.buckets SET public = ${fields.public}, file_size_limit = ${fields.file_size_limit || "NULL"}, allowed_mime_types = ${types} WHERE id = '${sourceForDifference(inputs, difference).observed.identity.replaceAll("'", "''")}';`);
  }
  const acl = byPrefix("function_acl|").filter((entry) => !removedFunctionIdentities.has(sourceForDifference(inputs, entry).expected?.identity ?? sourceForDifference(inputs, entry).observed?.identity)); const aclFunctions = new Map();
  for (const difference of acl) { const { observed, expected } = sourceForDifference(inputs, difference); aclFunctions.set((observed ?? expected).identity, observed ?? expected); }
  for (const row of aclFunctions.values()) statements.push(`REVOKE ALL ON FUNCTION public.${row.identity} FROM PUBLIC, anon, authenticated, service_role;`);
  for (const difference of acl.filter((entry) => entry.classification !== "MISSING_IN_PRODUCTION")) {
    const row = sourceForDifference(inputs, difference).observed; const role = row.attribute.replace(/_execute$/, "");
    if (row.value === "true" && role !== "postgres") statements.push(`GRANT EXECUTE ON FUNCTION public.${row.identity} TO ${role === "PUBLIC" ? "PUBLIC" : quote(role)};`);
  }
  for (const difference of byPrefix("grants|")) {
    const { observed, expected } = sourceForDifference(inputs, difference);
    if (!observed && expected.object_type === "function_grant" && removedFunctionIdentities.has(expected.identity)) continue;
    statements.push(grantSql(observed ?? expected, Boolean(observed)));
  }
  return Object.freeze({ differences, statements, statementSha256: hashBytes(statements.join("\n")) });
}

export function verifyFixtureFidelity(inputs, observedRows) {
  const comparison = compareFingerprint(inputs.expected, observedRows);
  const differences = comparison.objectResults.filter((entry) => entry.classification !== "MATCH");
  const observedByKey = new Map(observedRows.map((row) => [rowKey(row), row]));
  const mapByKey = new Map(inputs.objectMap.differences.map((entry) => [
    [entry.section, entry.objectType, entry.schema, entry.objectName, entry.identity, entry.attribute].join("|"), entry,
  ]));
  if (differences.length !== mapByKey.size) throw new Error("R6_PRODUCTION_DRIFT_FIXTURE_IDENTITY_COUNT_MISMATCH");
  let identityMismatches = 0; let valueHashMismatches = 0;
  for (const difference of differences) {
    const mapped = mapByKey.get(difference.key);
    if (!mapped || mapped.comparatorStatus !== difference.classification) { identityMismatches += 1; continue; }
    const frozen = inputs.rawByKey.get(difference.key);
    const observed = observedByKey.get(difference.key);
    if (difference.classification === "MISSING_IN_PRODUCTION") {
      if (observed || mapped.observedDefinitionHash !== null) valueHashMismatches += 1;
    } else if (!frozen || !observed || observed.value !== frozen.value || observed.definition_hash !== frozen.definition_hash || mapped.observedDefinitionHash !== frozen.definition_hash) valueHashMismatches += 1;
  }
  const securityPriorities = Object.fromEntries(["SECURITY_CRITICAL", "HIGH", "MEDIUM"].map((priority) => [priority, inputs.objectMap.differences.filter((entry) => entry.securityPriority === priority).length]));
  if (identityMismatches || valueHashMismatches || JSON.stringify(securityPriorities) !== JSON.stringify({ SECURITY_CRITICAL: 55, HIGH: 53, MEDIUM: 2 })) throw new Error("R6_PRODUCTION_DRIFT_FIXTURE_FORENSIC_FIDELITY_MISMATCH");
  return Object.freeze({ comparison, identityMismatches, valueHashMismatches, securityPriorities });
}

export async function captureCatalog(root, container) {
  const csv = docker(["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "--csv"], await loadPacketSql(root));
  const rows = parseCsv(csv);
  return Object.freeze({ rows, fingerprint: buildFingerprint(rows, await migrationSourceIndex(root)), fingerprintSha256: sha256(JSON.stringify(buildFingerprint(rows, await migrationSourceIndex(root)))) });
}

function parseTerminal(output) {
  const rows = output.trim().split(/\r?\n/).filter((line) => line.startsWith("{"));
  if (!rows.length) throw new Error("R6_PRODUCTION_DRIFT_FIXTURE_NORMALIZED_BOOTSTRAP_OUTPUT_INVALID");
  return JSON.parse(rows.at(-1));
}
function taskId() { return `r6-final-contract-${randomUUID()}`; }
function containerName(id) { return `openglass-normalized-replay-${id.slice("r6-final-contract-".length)}`; }
export async function runNormalizedFixtureRuntime({ root, inputs, label }) {
  const id = taskId(); const container = containerName(id); let cleanup = null;
  try {
    const bootstrap = parseTerminal(node(root, ["scripts/qa/create-task-scoped-normalized-replay.mjs", "--task-id", id]));
    if (bootstrap.classification !== "NORMALIZED_REPLAY_TASK_CONTAINER_READY" || bootstrap.migrationCount !== 43 || bootstrap.dockerPulls !== 0 || bootstrap.remoteOperations !== 0) throw new Error("R6_PRODUCTION_DRIFT_FIXTURE_NORMALIZED_BOOTSTRAP_INVALID");
    const canonical = await captureCatalog(root, container);
    const canonicalComparison = compareFingerprint(inputs.expected, canonical.rows);
    if (canonicalComparison.counts.MATCH !== inputs.expected.objectCount || canonicalComparison.counts.MISSING_IN_PRODUCTION || canonicalComparison.counts.DIVERGENT_IN_PRODUCTION || canonicalComparison.counts.EXTRA_IN_PRODUCTION || canonicalComparison.counts.INSUFFICIENT_EVIDENCE) throw new Error(`R6_CANONICAL_NORMALIZED_REPLAY_BASELINE_NOT_EQUIVALENT_${JSON.stringify(canonicalComparison.counts)}`);
    const compiled = compileStructuralDriftFixture(inputs);
    docker(["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], `BEGIN;\n${compiled.statements.join("\n")}\nCOMMIT;\n`);
    const observed = await captureCatalog(root, container);
    const fidelity = verifyFixtureFidelity(inputs, observed.rows);
    if (JSON.stringify(fidelity.comparison.objectResults) !== JSON.stringify(inputs.comparison.objectResults)) throw new Error("R6_PRODUCTION_DRIFT_STRUCTURAL_FIXTURE_NOT_REPRESENTATIVE");
    return Object.freeze({ id, label, bootstrap, canonicalComparison, canonicalFingerprintSha256: canonical.fingerprintSha256, compiled, comparison: fidelity.comparison, fidelity, observedFingerprintSha256: observed.fingerprintSha256 });
  } finally {
    try { cleanup = parseTerminal(node(root, ["scripts/qa/cleanup-task-scoped-normalized-replay.mjs", "--task-id", id])); } catch (error) { throw new Error(`R6_PRODUCTION_DRIFT_FIXTURE_CLEANUP_FAILED_${error.message}`); }
    if (cleanup.classification !== "NORMALIZED_REPLAY_TASK_CONTAINER_CLEANED") throw new Error("R6_PRODUCTION_DRIFT_FIXTURE_CLEANUP_INVALID");
  }
}
