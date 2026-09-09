import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import assert from "node:assert/strict";

const root = process.cwd();
const fixturePath = path.join(root, "tests/fixtures/device-schema-v1/schema-contract-cases.json");

function regexFromCase(testCase) {
  return new RegExp(testCase.pattern, testCase.flags ?? "is");
}

function withoutSqlComments(sql) {
  return sqlTokens(sql).filter((token) => !token.comment).map((token) => token.text).join("");
}

// Keep quoted strings/function bodies opaque so their semicolons and SQL-like
// text cannot become policy, grant, or INSERT statements. Preserve separators
// when removing comments (including nested PostgreSQL block comments).
function sqlTokens(sql) {
  const tokens = [];
  for (let index = 0; index < sql.length;) {
    const rest = sql.slice(index);
    if (rest.startsWith("/*")) {
      let end = index + 2;
      let depth = 1;
      while (end < sql.length && depth) {
        if (sql.startsWith("/*", end)) { depth += 1; end += 2; }
        else if (sql.startsWith("*/", end)) { depth -= 1; end += 2; }
        else end += 1;
      }
      assert.equal(depth, 0, "Unterminated SQL comment");
      tokens.push({ text: " ", comment: false });
      index = end;
      continue;
    }
    const comment = /^--[^\r\n]*/.exec(rest);
    if (comment) {
      tokens.push({ text: " ", comment: false });
      index += comment[0].length;
      continue;
    }
    const dollar = /^\$(?:[a-z_][a-z_0-9]*)?\$/i.exec(rest)?.[0];
    if (dollar) {
      const end = sql.indexOf(dollar, index + dollar.length);
      assert.notEqual(end, -1, "Unterminated SQL dollar quote");
      tokens.push({ text: sql.slice(index, end + dollar.length), quoted: true });
      index = end + dollar.length;
      continue;
    }
    const quoted = /^(?:'(?:''|[^'])*'|"(?:""|[^"])*")/.exec(rest);
    if (quoted) {
      tokens.push({ text: quoted[0], quoted: true });
      index += quoted[0].length;
      continue;
    }
    tokens.push({ text: sql[index] });
    index += 1;
  }
  return tokens;
}

function sqlStatements(sql) {
  const statements = [];
  let statement = "";
  for (const token of sqlTokens(sql)) {
    statement += token.text;
    if (token.text === ";" && !token.quoted) {
      statements.push(statement.trim());
      statement = "";
    }
  }
  if (statement.trim()) statements.push(statement.trim());
  return statements;
}

function findCreateTableBody(sql, tableName) {
  const start = new RegExp(`create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+(?:public\\.)?${tableName}\\s*\\(`, "i").exec(sql);
  if (!start) return null;
  const open = start.index + start[0].lastIndexOf("(");
  let depth = 0;
  let quote = null;
  for (let index = open; index < sql.length; index += 1) {
    const character = sql[index];
    if (quote) {
      if (character === quote && sql[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return sql.slice(open + 1, index);
    }
  }
  return null;
}

function statementsMatching(sql, keyword) {
  return sqlStatements(sql).filter((statement) => new RegExp(`^${keyword}\\b`, "i").test(statement));
}

// Preserve offsets while making quoted text and nested expressions inert.
// Clause keywords belong to the policy header, never to predicate contents.
function topLevelPolicyText(body) {
  let depth = 0;
  let text = "";
  for (const token of sqlTokens(body)) {
    if (token.quoted) {
      text += "?".repeat(token.text.length);
      continue;
    }
    text += depth === 0 ? token.text : "?".repeat(token.text.length);
    if (token.text === "(") depth += 1;
    if (token.text === ")") depth -= 1;
  }
  return text;
}

function policyExpression(body, clause, topLevelText) {
  const match = new RegExp(`\\b${clause}\\s*\\(`, "i").exec(topLevelText);
  if (!match) return undefined;
  let depth = 1;
  let expression = "";
  for (const token of sqlTokens(body.slice(match.index + match[0].length))) {
    if (!token.quoted && token.text === "(") depth += 1;
    if (!token.quoted && token.text === ")") depth -= 1;
    if (depth === 0) return expression;
    // A literal that spells is_catalog_admin() is not a predicate call.
    expression += token.quoted ? "?" : token.text;
  }
  assert.fail(`Unterminated policy ${clause} expression`);
}

function finalPolicies(sql) {
  const policies = new Map();
  const identifier = '(?:"(?:""|[^"])+"|[a-z_][a-z_0-9$]*)';
  const header = new RegExp(`^(create|alter|drop)\\s+policy\\s+(?:if\\s+exists\\s+)?(${identifier})\\s+on\\s+(?:(${identifier})\\s*\\.\\s*)?(${identifier})\\b([\\s\\S]*)$`, "i");
  const normalize = (name) => name.startsWith('"') ? name.slice(1, -1).replaceAll('""', '"') : name.toLowerCase();
  for (const statement of sqlStatements(sql)) {
    if (!/^(?:create|alter|drop)\s+policy\b/i.test(statement)) continue;
    const match = header.exec(statement);
    assert.ok(match, `Unsupported policy statement: ${statement}`);
    const [, actionText, nameText, schemaText, tableText, body] = match;
    const action = actionText.toLowerCase();
    const name = normalize(nameText);
    const schema = normalize(schemaText ?? "public");
    const table = normalize(tableText);
    const key = JSON.stringify([schema, table, name]);
    if (action === "drop") { policies.delete(key); continue; }
    const topLevelText = topLevelPolicyText(body);
    let policy = policies.get(key);
    if (action === "create") {
      assert.ok(!policy, `Duplicate policy: ${name}`);
      policy = { schema, table, name, command: /\bfor\s+(all|select|insert|update|delete)\b/i.exec(topLevelText)?.[1].toLowerCase() ?? "all", roles: "public" };
    } else {
      assert.ok(policy, `ALTER POLICY has no preceding CREATE POLICY: ${name}`);
    }
    const rename = new RegExp(`^\\s+rename\\s+to\\s+(${identifier})\\s*;?$`, "i").exec(body);
    if (rename) {
      policies.delete(key);
      policy.name = normalize(rename[1]);
      policies.set(JSON.stringify([schema, table, policy.name]), policy);
      continue;
    }
    const roles = /^\s*(?:as\s+(?:permissive|restrictive)\s*)?(?:for\s+(?:all|select|insert|update|delete)\s*)?to\s+(.+?)(?=\s+(?:using|with\s+check)\b|;?$)/i.exec(body)?.[1];
    if (roles !== undefined) policy.roles = roles;
    for (const [field, clause] of [["using", "using"], ["check", "with\\s+check"]]) {
      const expression = policyExpression(body, clause, topLevelText);
      if (expression !== undefined) policy[field] = expression;
    }
    policies.set(key, policy);
  }
  return [...policies.values()].filter((policy) => policy.schema === "public");
}

function assertAdminPolicy(policy, prefix) {
  if (["select", "update", "delete", "all"].includes(policy.command)) {
    assert.match(policy.using ?? "", /\bis_catalog_admin\s*\(/i, `${prefix} must bind is_catalog_admin in USING`);
  }
  if (["insert", "update", "all"].includes(policy.command)) {
    // PostgreSQL uses USING as WITH CHECK when the latter is omitted.
    assert.match(policy.check ?? policy.using ?? "", /\bis_catalog_admin\s*\(/i, `${prefix} must bind is_catalog_admin in WITH CHECK`);
  }
}

function assertNoNormalizedPublicAccess(sql, contract, policies = finalPolicies(sql)) {
  for (const table of contract.normalizedTables ?? []) {
    for (const statement of statementsMatching(sql, "grant")) {
      if (!new RegExp(`\\bon\\s+(?:table\\s+)?(?:public\\.)?${table}\\b`, "i").test(statement)) continue;
      const privileges = statement.replace(/^grant\\s+/i, "");
      const roleMatch = /\bto\s+(.+?)\s*;?$/i.exec(privileges);
      const roleList = roleMatch?.[1] ?? "";
      const grantsSelect = /\ball(?:\s+privileges)?\b|\bselect\b/i.test(privileges);
      if (grantsSelect && /\b(?:anon|public)\b/i.test(roleList)) {
        throw new assert.AssertionError({ message: `Forbidden normalized anon/public grant: ${table}` });
      }
    }
    for (const policy of policies.filter((entry) => entry.table === table)) {
      if (/\b(?:anon|public)\b/i.test(policy.roles)) {
        throw new assert.AssertionError({ message: `Forbidden normalized anon/public ${policy.command} policy: ${table}` });
      }
    }
  }
}

function assertStructuralContract(migrationText, contract) {
  const sql = withoutSqlComments(migrationText);
  const policies = finalPolicies(sql);
  assertNoNormalizedPublicAccess(sql, contract, policies);

  for (const table of contract.catalogAuthorityTables ?? []) {
    assert.ok(
      policies.some((policy) => policy.table === table && policy.command !== "select"),
      `Catalog authority requires a mutation policy on ${table}`,
    );
  }

  const auditTable = contract.auditTable ?? "catalog_audit_events";
  const auditBody = findCreateTableBody(sql, auditTable);
  assert.ok(auditBody, `Missing create-table body for ${auditTable}`);
  const auditPolicies = policies.filter((policy) => policy.table === auditTable);
  for (const policy of auditPolicies) {
    assert.ok(["insert", "select"].includes(policy.command), `Audit policy must not authorize update/delete: ${policy.name}`);
    assertAdminPolicy(policy, `Audit ${policy.command} policy`);
  }
  for (const command of ["insert", "select"]) {
    assert.ok(
      auditPolicies.some((policy) => policy.command === command),
      `Audit ${command} policy must bind is_catalog_admin in its body`,
    );
  }
  for (const privilege of ["update", "delete"]) {
    const denied = statementsMatching(sql, "revoke").some((statement) =>
      new RegExp(`\\b(?:all(?:\\s+privileges)?|${privilege}(?:\\s*,\\s*(?:update|delete))?|(?:update|delete)\\s*,\\s*${privilege})\\b[\\s\\S]*\\bon\\s+(?:table\\s+)?(?:public\\.)?${auditTable}\\b`, "i").test(statement),
    );
    assert.ok(denied, `Audit must explicitly deny ${privilege}`);
  }
  for (const statement of statementsMatching(sql, "grant")) {
    if (!new RegExp(`\\bon\\s+(?:table\\s+)?(?:public\\.)?${auditTable}\\b`, "i").test(statement)) continue;
    assert.doesNotMatch(statement, /\ball(?:\s+privileges)?\b|\b(?:update|delete)\b/i, `Audit grants must not authorize update/delete: ${statement}`);
  }
  for (const policy of policies) {
    if ((contract.normalizedTables ?? []).includes(policy.table) && policy.table !== auditTable && policy.command !== "select") {
      assertAdminPolicy(policy, `Every ${policy.command} policy on ${policy.table}`);
    }
  }

  const evidenceBody = findCreateTableBody(sql, "device_spec_evidence");
  assert.ok(evidenceBody, "Missing device_spec_evidence table body");
  assert.match(evidenceBody, /\bis_primary\s+boolean\b/i, "Evidence must define is_primary in its table body");
  assert.match(evidenceBody, /\bis_conflicting\s+boolean\b/i, "Evidence must define is_conflicting in its table body");
  assert.match(evidenceBody, /check\s*\(\s*not\s*\(\s*is_primary\s+and\s+is_conflicting\s*\)\s*\)/i, "Evidence must locally prohibit primary and conflicting together");

  const definitionSeeds = statementsMatching(sql, "insert\\s+into").filter((statement) => /\binsert\s+into\s+(?:public\.)?device_spec_definitions\b/i.test(statement));
  for (const seed of contract.definitionSeedCases ?? []) {
    const matchingSeed = definitionSeeds.some((statement) =>
      new RegExp(seed.keyPattern, "i").test(statement) && new RegExp(seed.contextPattern, "i").test(statement),
    );
    assert.ok(matchingSeed, `Definition seed missing key/context: ${seed.name}`);
  }
}

export function assertSyntheticWeakCases(contract) {
  const baseline = contract.syntheticBaselineStatements.join("\n");
  assertSchemaV1Contract({ migrationText: baseline, cases: contract });
  function migrationFor(testCase) {
    let sql = baseline;
    if (testCase.replace) {
      assert.equal(sql.split(testCase.replace.from).length - 1, 1, `Synthetic replacement must match once: ${testCase.name}`);
      sql = sql.replace(testCase.replace.from, testCase.replace.to);
    }
    return `${sql}\n${testCase.appendSql ?? ""}`;
  }
  for (const weakCase of contract.syntheticWeakCases ?? []) {
    assert.throws(
      () => assertSchemaV1Contract({ migrationText: migrationFor(weakCase), cases: contract }),
      (error) => error instanceof assert.AssertionError && (weakCase.exactError
        ? error.message === weakCase.expectedError
        : error.message.includes(weakCase.expectedError)),
      `Synthetic weak SQL unexpectedly passed: ${weakCase.name}`,
    );
  }
  for (const validCase of contract.syntheticValidCases ?? []) {
    assert.doesNotThrow(
      () => assertSchemaV1Contract({ migrationText: migrationFor(validCase), cases: contract }),
      `Valid synthetic SQL rejected: ${validCase.name}`,
    );
  }
  return (contract.syntheticWeakCases ?? []).length;
}

/**
 * Assert the static SQL contract for Database Schema v1 Release A.
 * The migration is intentionally supplied by a later task; this task defines
 * the contract and keeps the suite RED while that migration is absent.
 */
export function assertSchemaV1Contract({ migrationText, cases }) {
  assert.equal(typeof migrationText, "string", "migrationText must be SQL text");
  assert.match(migrationText, /create table.*public\.device_specs/s, "Foundation must create device_specs");
  const contract = cases ?? { required: [], forbidden: [] };

  for (const testCase of contract.required ?? []) {
    assert.match(migrationText, regexFromCase(testCase), `Missing Schema v1 contract: ${testCase.name}`);
  }
  for (const testCase of contract.forbidden ?? []) {
    assert.doesNotMatch(migrationText, regexFromCase(testCase), `Forbidden Schema v1 SQL: ${testCase.name}`);
  }
  assertStructuralContract(migrationText, contract);
  return true;
}

// Task 2 proves the additive foundation independently of the later enforcement,
// authority, and registry tasks. The default entrypoint still runs the full gate.
export function assertSchemaV1Foundation({ migrationText, cases }) {
  const sql = withoutSqlComments(migrationText);
  assert.match(sql, /create table.*public\.device_specs/s, "Foundation must create device_specs");
  for (const testCase of cases.required.filter((entry) => entry.name !== "catalog admin predicate")) {
    assert.match(sql, regexFromCase(testCase), `Missing foundation contract: ${testCase.name}`);
  }
  for (const testCase of cases.forbidden) assert.doesNotMatch(sql, regexFromCase(testCase), testCase.name);
  const tables = Object.fromEntries(cases.normalizedTables.map((table) => [table, findCreateTableBody(sql, table)]));
  for (const [table, body] of Object.entries(tables)) {
    assert.ok(body, `Missing foundation table body: ${table}`);
    assert.match(body, /\bid\s+uuid\s+primary\s+key\s+default\s+gen_random_uuid\(\)/i, `${table} requires UUID identity`);
    assert.match(body, /\bcreated_at\s+timestamptz\s+not\s+null\s+default\s+now\(\)/i, `${table} requires creation timestamp`);
  }
  for (const [table, column, target] of [
    ["device_specs", "device_id", "devices"],
    ["device_specs", "spec_definition_id", "device_spec_definitions"],
    ["device_source_links", "device_id", "devices"],
    ["device_source_links", "source_id", "device_sources"],
    ["device_spec_evidence", "device_spec_id", "device_specs"],
    ["device_spec_evidence", "source_id", "device_sources"],
  ]) {
    assert.match(tables[table], new RegExp(`\\b${column}\\s+uuid\\s+not\\s+null\\s+references\\s+public\\.${target}\\(id\\)\\s+on\\s+delete\\s+restrict`, "i"), `${table}.${column} requires restrictive foreign key`);
  }
  for (const [column, fallback] of [["region", "Global"], ["variant", ""]]) {
    assert.match(tables.device_specs, new RegExp(`\\b${column}_key\\s+text\\s+generated\\s+always\\s+as\\s*\\(coalesce\\(${column},\\s*'${fallback}'\\)\\)\\s+stored`, "i"), `${column} must have a stored NULL-safe key`);
  }
  for (const [table, pattern] of [
    ["device_spec_definitions", /\bkey\s+text\s+not\s+null\s+unique/i],
    ["device_spec_definitions", /check\s*\(length\(btrim\(key\)\)\s*>\s*0\)/i],
    ["device_specs", /unique\s*\(device_id,\s*spec_definition_id,\s*region_key,\s*variant_key\)/i],
    ["device_sources", /\burl\s+text\s+not\s+null\s+unique/i],
    ["device_source_links", /unique\s*\(device_id,\s*source_id\)/i],
    ["device_spec_evidence", /unique\s*\(device_spec_id,\s*source_id,\s*claimed_value\)/i],
    ["device_spec_evidence", /check\s*\(not\s*\(is_primary\s+and\s+is_conflicting\)\)/i],
  ]) assert.match(tables[table], pattern, `${table} is missing a required key/check`);
  for (const [table, key] of [["device_source_links", "device_id"], ["device_spec_evidence", "device_spec_id"]]) {
    assert.match(sql, new RegExp(`create\\s+unique\\s+index\\s+if\\s+not\\s+exists\\s+\\w+\\s+on\\s+public\\.${table}\\s*\\(${key}\\)\\s+where\\s+is_primary\\s*=\\s*true`, "i"), `${table} must allow at most one primary row`);
  }
  // A foundation migration must not import data or remove existing objects.
  for (const statement of sqlStatements(sql)) {
    assert.doesNotMatch(statement, /^(?:insert|update|delete|truncate|drop)\b/i, "Foundation must remain additive and data-free");
    assert.doesNotMatch(topLevelPolicyText(statement), /^alter\s+table\b[\s\S]*\bdrop\b/i, "Foundation must not drop columns or constraints through ALTER TABLE");
  }
  assertNoNormalizedPublicAccess(sql, cases);
  return true;
}

export function assertFoundationWeakCases({ migrationText, cases }) {
  assertSchemaV1Foundation({ migrationText, cases });
  for (const testCase of cases.foundationWeakCases) {
    assert.throws(
      () => assertSchemaV1Foundation({ migrationText: `${migrationText}\n${testCase.appendSql}`, cases }),
      (error) => error instanceof assert.AssertionError && error.message === testCase.expectedError,
      `Foundation weak SQL unexpectedly passed: ${testCase.name}`,
    );
  }
  return cases.foundationWeakCases.length;
}

async function main() {
  const contract = JSON.parse(await readFile(fixturePath, "utf8"));
  const syntheticCount = assertSyntheticWeakCases(contract);
  console.log(`DEVICE_SCHEMA_V1_SYNTHETIC_RED_OK count=${syntheticCount}`);
  if (process.argv.includes("--synthetic-only")) return;
  // The plan's timestamp is illustrative. Keep the actual CLI-generated version
  // and fail closed if more than one foundation migration matches the suffix.
  const migrationDirectory = path.join(root, "supabase/migrations");
  const migrationFiles = (await readdir(migrationDirectory)).filter((file) => /^\d{14}_device_schema_v1_foundation\.sql$/.test(file));
  assert.ok(migrationFiles.length <= 1, "Multiple Schema v1 foundation migrations found");
  const migrationPath = migrationFiles.length === 1
    ? path.join(migrationDirectory, migrationFiles[0])
    : path.join(root, contract.migrationPath);
  let migrationText;
  try {
    migrationText = await readFile(migrationPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Schema v1 migration missing: ${contract.migrationPath}`);
    }
    throw error;
  }

  if (process.argv.includes("--foundation-only")) {
    const foundationCount = assertFoundationWeakCases({ migrationText, cases: contract });
    console.log(`DEVICE_SCHEMA_V1_FOUNDATION_SYNTHETIC_RED_OK count=${foundationCount}`);
    console.log("DEVICE_SCHEMA_V1_FOUNDATION_OK");
    return;
  }
  assertSchemaV1Contract({ migrationText, cases: contract });
  console.log("DEVICE_SCHEMA_V1_CONTRACT_OK");
}

if (path.basename(process.argv[1] ?? "") === "test-device-schema-v1-contract.mjs") {
  main().catch((error) => {
    console.error(`DEVICE_SCHEMA_V1_CONTRACT_FAIL ${error.message}`);
    process.exitCode = 1;
  });
}
