import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");
const migrationPath = path.join(root, "supabase", "migrations", "20260904054013_forward_reconcile_security_privileges.sql");

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
