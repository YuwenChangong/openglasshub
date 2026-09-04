import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");
const migrationPath = path.join(root, "supabase", "migrations", "20260904054013_forward_reconcile_security_privileges.sql");
const matrixPath = path.join(root, "docs", "release", "canonical-privilege-drift-matrix.json");

const protectedFunctions = [
  "public.can_access_comment_reaction_target(uuid)",
  "public.can_access_public_circle_cover_object(text)",
  "public.can_access_public_circle(uuid)",
  "public.can_access_public_comment_read_target(uuid)",
  "public.can_access_public_post_media_object(text)",
  "public.can_access_public_profile_media_object(text)",
  "public.can_create_comment_target(uuid, uuid)",
  "public.can_create_user_report_target(text, uuid)",
  "public.consume_verification_email_resend_limit(text, integer, integer)",
  "public.increment_post_view_count(uuid)",
  "public.prevent_unauthorized_profile_role_change()",
];

test("privilege convergence migration exists with exact protected function signatures", async () => {
  const sql = await readFile(migrationPath, "utf8");
  for (const signature of protectedFunctions) {
    assert.match(sql, new RegExp(`revoke execute on function ${signature.replace(/[()]/g, "\\$&")}\\s+from`, "i"));
  }
});

test("privilege convergence removes only unsafe direct client and service-role function grants", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /revoke execute on function public\.can_create_comment_target\(uuid, uuid\)\s+from public, anon, service_role;/i);
  assert.match(sql, /grant execute on function public\.can_create_comment_target\(uuid, uuid\)\s+to authenticated;/i);
  assert.match(sql, /revoke execute on function public\.prevent_unauthorized_profile_role_change\(\)\s+from public, anon, authenticated, service_role;/i);
  assert.doesNotMatch(sql, /(?:auth|storage|extensions|pg_catalog|information_schema)\./i);
  assert.doesNotMatch(sql, /\b(?:insert|update|delete)\s+into\b/i);
  assert.doesNotMatch(sql, /revoke\s+all\s+on\s+all\s+functions/i);
});

test("frozen 48-migration evidence proves the pre-migration comment helper was unsafe", async () => {
  const matrix = JSON.parse(await readFile(matrixPath, "utf8"));
  assert(matrix.entries.some((entry) => entry.objectIdentity === "can_create_comment_target(uuid,uuid)" && entry.principal === "anon" && entry.privilege === "EXECUTE"), "B1 direct ACL evidence must retain the forbidden anonymous execute grant");
  assert(matrix.effectiveFunctionPrivilegeEntries.some((entry) => entry.signature === "public.can_create_comment_target(uuid,uuid)" && entry.principal === "anon" && entry.expectedBefore === false && entry.observedAfter48Replay === true), "B1 effective privilege evidence must retain the false-to-true anonymous execute violation");
});

test("privilege convergence revokes every approved direct ACL expansion and no system object", async () => {
  const [sql, matrixText] = await Promise.all([readFile(migrationPath, "utf8"), readFile(matrixPath, "utf8")]);
  const matrix = JSON.parse(matrixText);
  assert.equal(matrix.candidateSha256, "d453f7ba185fa1237f03a0b890154038b2f88e20183dbd92a16020bf574823db");
  assert.equal(matrix.directAclExpansionCount, 188);
  assert.equal(matrix.entries.length, 188);
  assert.equal(matrix.effectiveFunctionPrivilegeExpansionCount, 12);
  assert.equal(matrix.effectiveFunctionPrivilegeEntries.length, 12);
  assert.equal(matrix.requiredContractRevocations.length, 8);
  assert(matrix.entries.every((entry) => entry.classification === "PROVEN_UNAUTHORIZED_EXPANSION" && entry.remediationRequired));
  const actual = new Set();
  const executableSql = sql.replace(/--.*$/gm, "");
  for (const statement of executableSql.split(";")) {
    const match = /^\s*revoke\s+(.+?)\s+on\s+(function|table)\s+(.+?)\s+from\s+(.+?)\s*$/i.exec(statement);
    if (!match) continue;
    const [, privileges, kind, identity, principals] = match;
    for (const privilege of privileges.split(",").map((value) => value.trim().toUpperCase())) {
      for (const principal of principals.split(",").map((value) => value.trim())) {
        actual.add([kind.toUpperCase(), identity.replace(/^public\./i, "").replace(/\bpublic\./gi, "").replace(/\s+/g, ""), principal, privilege].join("|"));
      }
    }
  }
  const required = [...matrix.entries, ...matrix.requiredContractRevocations].map((entry) => [entry.objectKind, entry.objectIdentity.replace(/\bpublic\./gi, "").replace(/\s+/g, ""), entry.principal.toLowerCase(), entry.privilege].join("|"));
  assert.equal(new Set(required).size, 196, "every direct expansion and canonical contract revocation is unique");
  assert.deepEqual([...actual].sort(), [...required].sort(), "migration revocations must exactly equal the reviewed direct-ACL matrix plus the documented canonical contract revocations");
});
