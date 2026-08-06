import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PHASE4A2_STATUS } from "../tests/fixtures/legal-consent-phase4a2.mjs";
import { PHASE4B_WAVE4_STATUS } from "../tests/fixtures/legal-consent-phase4b-wave4.mjs";
import * as methodTraceFixture from "../tests/fixtures/legal-consent-api-methods.mjs";
import { completedBatchIds, expectedMethodCount } from "../tests/fixtures/legal-consent-api-trace-batches.mjs";
import { REQUIRED_FORWARD_MIGRATIONS } from "./lib/legal-consent-forward-migration-inventory.mjs";
import { evaluateLegalNonproductionTargetProvisioning } from "./lib/legal-nonproduction-target-binding.mjs";

const root = process.cwd();
const migrationDirectory = path.join(root, "supabase", "migrations");

export { REQUIRED_FORWARD_MIGRATIONS } from "./lib/legal-consent-forward-migration-inventory.mjs";

const securityDefinerAcl = [
  ["public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid)", "service_role", ["anon", "authenticated"]],
  ["public.increment_post_view_count(uuid)", "anon, authenticated", ["service_role"]],
  ["public.can_create_user_report_target(text, uuid)", "authenticated", ["anon", "service_role"]],
];
const destructivePatterns = [/\bdrop\s+table\b/i, /\btruncate\b/i, /\bdrop\s+column\b/i, /\bdelete\s+from\b/i, /\bgrant\s+all\b/i];

const requiredFiles = REQUIRED_FORWARD_MIGRATIONS.map(({ file }) => file);
const discoveredFiles = (await readdir(migrationDirectory))
  .filter((file) => /^202607(?:03|12|13|14|15|16|17)_.*\.sql$/.test(file))
  .sort();
assert.deepEqual(discoveredFiles, requiredFiles, "The authored forward migration inventory must be exact and ordered.");

for (const [index, { file, dependencies, fragments }] of REQUIRED_FORWARD_MIGRATIONS.entries()) {
  const source = await readFile(path.join(migrationDirectory, file), "utf8");
  for (const fragment of fragments) assert(source.includes(fragment), `${file} must retain ${fragment}.`);
  for (const dependency of dependencies) assert(requiredFiles.indexOf(dependency) < index, `${file} must follow ${dependency}.`);
  for (const pattern of destructivePatterns) assert(!pattern.test(source), `${file} contains disallowed SQL: ${pattern}.`);
  for (const match of source.matchAll(/create\s+policy\s+"([^"]+)"/gi)) {
    assert(new RegExp(`drop\\s+policy\\s+if\\s+exists\\s+"${match[1]}"`, "i").test(source), `${file} must drop ${match[1]} before recreation.`);
  }
  if (/security\s+definer/i.test(source)) assert(/set\s+search_path\s*=\s*public(?:\s*,\s*pg_temp)?/i.test(source), `${file} must set an explicit SECURITY DEFINER search_path.`);
}

const hardeningSource = await readFile(path.join(migrationDirectory, "20260717_security_definer_execute_hardening.sql"), "utf8");
assert.doesNotMatch(hardeningSource, /grant\s+(?:all|execute)\s+on\s+function[^;]+\bto\s+public\b/i, "No function may be granted to PUBLIC.");
assert.doesNotMatch(hardeningSource, /grant\s+all\b/i, "No broad grant is allowed.");
assert.doesNotMatch(hardeningSource, /\b(?:create|alter\s+table|insert|update|delete|truncate|drop)\b/i, "Hardening migration must contain ACL statements only.");
for (const [signature, grantRoles, deniedRoles] of securityDefinerAcl) {
  const revokeIndex = hardeningSource.indexOf(`revoke execute on function ${signature}`);
  const grantIndex = hardeningSource.indexOf(`grant execute on function ${signature}`);
  assert.ok(revokeIndex >= 0 && grantIndex > revokeIndex, `${signature} must revoke before its grant.`);
  assert.match(hardeningSource.slice(revokeIndex, grantIndex), /from\s+public/i, `${signature} must explicitly revoke PUBLIC execution.`);
  const grantStatement = hardeningSource.slice(grantIndex, hardeningSource.indexOf(";", grantIndex)).replace(/\s+/g, " ").trim().toLowerCase();
  assert.equal(grantStatement, `grant execute on function ${signature} to ${grantRoles}`.toLowerCase(), `${signature} must grant only ${grantRoles}.`);
  for (const deniedRole of deniedRoles) assert.doesNotMatch(grantStatement, new RegExp(`\\b${deniedRole}\\b`, "i"), `${signature} must not grant ${deniedRole}.`);
}
const changedMigrations = execFileSync("git", ["diff", "--name-only", "HEAD", "--", "supabase/migrations"], { cwd: root, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
assert(changedMigrations.every((file) => file === "supabase/migrations/20260717_security_definer_execute_hardening.sql"), "No historical migration may be changed.");

const moderationWriter = await readFile(path.join(root, "src/lib/server/moderation-notifications.server.ts"), "utf8");
assert(/createModerationNotificationWriter\(\s*env: RuntimeEnv,\s*verifiedActorId: string,/s.test(moderationWriter), "Migration 12 requires the authenticated actor-bound moderation writer.");
assert(/client\.rpc\("insert_forum_notification", \{[\s\S]*?p_actor_id: verifiedActorId/.test(moderationWriter), "The moderation writer must invoke only the fixed RPC with the verified actor.");
assert.doesNotMatch(moderationWriter, /client\.(?:from|storage|functions)\(/, "The moderation writer must not expose privileged table, storage, or function access.");
for (const route of [
  "src/pages/api/admin/users/[id]/ban.ts",
  "src/pages/api/admin/users/[id]/clear-warning.ts",
  "src/pages/api/admin/users/[id]/suspend.ts",
  "src/pages/api/admin/users/[id]/unban.ts",
  "src/pages/api/admin/users/[id]/warn.ts",
  "src/pages/api/admin/reports/[id]/action.ts",
]) {
  const routeSource = await readFile(path.join(root, route), "utf8");
  const auth = routeSource.indexOf("requireModerator(request, env)");
  const consent = routeSource.indexOf("const consent = await requireAuthenticatedLegalConsent");
  const writer = routeSource.indexOf("createModerationNotificationWriter(env, auth.user.id)");
  assert.ok(auth >= 0 && consent > auth && writer > consent, `${route} must create the writer only after staff authorization and consent.`);
}

const legalPolicy = await readFile(path.join(root, "src/lib/legal-policy.ts"), "utf8");
const publicLegalContacts = await readFile(path.join(root, "src/lib/public-legal-contacts.ts"), "utf8");
for (const name of ["PUBLIC_LEGAL_OPERATOR_NAME", "PUBLIC_SUPPORT_EMAIL", "PUBLIC_ABUSE_EMAIL", "PUBLIC_PRIVACY_EMAIL", "PUBLIC_IP_EMAIL"]) assert(publicLegalContacts.includes(name), `${name} is a public launch prerequisite.`);
assert(legalPolicy.includes('bundleVersion: "2026-07"'), "The active legal bundle must remain server-defined.");
const contactPage = await readFile(path.join(root, "src/pages/contact/index.astro"), "utf8");
assert(contactPage.includes("showPublicContacts={true}"), "Contact page must render the validated public legal contact surface.");
const legalContacts = await readFile(path.join(root, "src/lib/public-legal-contacts.ts"), "utf8");
assert(legalContacts.includes("validatePublicLegalContacts"), "Public legal contacts must be validated before rendering.");

assert.equal(PHASE4A2_STATUS.integratedRepresentativeCount, 5);
assert.equal(PHASE4A2_STATUS.pendingRepresentativeCount, 0);
assert.equal(PHASE4B_WAVE4_STATUS.cumulativeIntegratedCount, 37);
assert.equal(PHASE4B_WAVE4_STATUS.remainingMutationCount, 0);
assert.equal(PHASE4B_WAVE4_STATUS.phase4BStatus, "complete");
const completeTraceIds = Object.values(methodTraceFixture)
  .filter((value) => value && typeof value === "object" && !Array.isArray(value))
  .flatMap((value) => Object.entries(value).filter(([, entry]) => entry?.traceStatus === "complete").map(([id]) => id));
assert.equal(new Set(completeTraceIds).size, expectedMethodCount, "Every Phase 4A1 method must retain complete trace evidence.");
assert.equal(completedBatchIds.size, 6, "All six Phase 4A1 parent batches must remain complete.");

const localTargetProvisioning = evaluateLegalNonproductionTargetProvisioning(null);
assert.equal(localTargetProvisioning.classification, "R6_LOCAL_NONPRODUCTION_TARGET_CREATION_REQUIRED");
console.log(JSON.stringify({ phase4A1: "66/66 traced", phase4A2: "5/5 integrated", phase4B: "37/37 integrated", migrationInventory: "12/12 exact and ordered", staticAclBlockers: [], publicLegalContactVariables: 5, localNonproductionTarget: localTargetProvisioning.classification, productionFingerprint: "BLOCKED_PENDING_FINGERPRINT", status: "NO_GO", realOperations: 0 }));
