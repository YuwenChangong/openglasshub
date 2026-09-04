import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");
const migrationPath = path.join(root, "supabase", "migrations", "20260904054013_forward_reconcile_security_privileges.sql");
const packetPath = path.join(root, "docs", "ops", "production-security-privilege-audit-v1.sql");
const manifestPath = path.join(root, "docs", "ops", "production-security-privilege-audit-v1.json");

function tuples(sql, verb) {
  const rows = [];
  for (const statement of sql.replace(/--.*$/gm, "").split(";")) {
    const match = new RegExp(`^\\s*${verb}\\s+(.+?)\\s+on\\s+(function|table)\\s+(.+?)\\s+${verb === "revoke" ? "from" : "to"}\\s+(.+?)\\s*$`, "i").exec(statement);
    if (!match) continue;
    const [, privileges, objectKind, objectIdentity, principals] = match;
    for (const privilege of privileges.split(",").map((value) => value.trim().toUpperCase())) {
      for (const principal of principals.split(",").map((value) => value.trim().toLowerCase())) {
        rows.push({ objectKind: objectKind.toUpperCase(), objectIdentity: objectIdentity.replace(/\\s+/g, ""), principal, privilege });
      }
    }
  }
  return rows;
}

test("production privilege packet represents every migration 49 privilege tuple without collapsing signatures", async () => {
  const [migration, manifestText] = await Promise.all([readFile(migrationPath, "utf8"), readFile(manifestPath, "utf8")]);
  const manifest = JSON.parse(manifestText);
  const expected = [...tuples(migration, "revoke").map((row) => ({ ...row, expectedDirectState: false })), ...tuples(migration, "grant").map((row) => ({ ...row, expectedDirectState: true }))];
  assert.equal(expected.filter((row) => !row.expectedDirectState).length, 196);
  assert.equal(expected.filter((row) => row.expectedDirectState).length, 6);
  assert.deepEqual(manifest.postconditions, expected);
  assert.equal(new Set(manifest.postconditions.map((row) => JSON.stringify(row))).size, 202);
});

test("production privilege packet is catalog-only and self-defensive", async () => {
  const [packet, manifestText] = await Promise.all([readFile(packetPath, "utf8"), readFile(manifestPath, "utf8")]);
  const manifest = JSON.parse(manifestText);
  assert.match(packet, /^BEGIN;\s*\n\s*SET TRANSACTION READ ONLY;/m);
  assert.match(packet, /SET LOCAL statement_timeout = '15s';/);
  assert.match(packet, /SET LOCAL lock_timeout = '3s';/);
  assert.match(packet, /ROLLBACK;\s*$/);
  assert.match(packet, /to_regprocedure\(expected\.object_identity\)/);
  assert.match(packet, /has_function_privilege/);
  assert.match(packet, /has_table_privilege/);
  assert.match(packet, /20260904054013/);
  assert.match(packet, /CAN_CREATE_COMMENT_TARGET_PUBLIC_EXECUTE/);
  assert.match(packet, /CAN_CREATE_COMMENT_TARGET_ANON_EXECUTE/);
  assert.match(packet, /CAN_CREATE_COMMENT_TARGET_AUTHENTICATED_EXECUTE/);
  assert.equal(manifest.staticValidation.catalogOnly, true);
  assert.equal(manifest.staticValidation.applicationDataReads, 0);
  assert.equal(manifest.staticValidation.ddl, 0);
  assert.equal(manifest.staticValidation.dml, 0);
  assert.equal(manifest.staticValidation.privilegeMutations, 0);
  assert.equal(manifest.staticValidation.setRole, 0);
  assert.equal(manifest.sqlSha256, createHash("sha256").update(packet).digest("hex").toUpperCase());
  const withoutLiterals = packet.replace(/'(?:''|[^'])*'/g, "''");
  assert.doesNotMatch(withoutLiterals, /^\s*(?:INSERT|UPDATE|DELETE|MERGE|GRANT|REVOKE|ALTER|CREATE|DROP|TRUNCATE|COMMENT|SECURITY\s+LABEL|SET\s+ROLE|DO|CALL)\b/im);
  assert.doesNotMatch(withoutLiterals, /\b(?:public\.(?:posts|profiles|comments|forum_notifications|devices)|auth\.users|storage\.objects)\b/i);
});
