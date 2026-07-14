import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PHASE4A2_STATUS } from "../tests/fixtures/legal-consent-phase4a2.mjs";
import { PHASE4B_WAVE4_STATUS } from "../tests/fixtures/legal-consent-phase4b-wave4.mjs";
import * as methodTraceFixture from "../tests/fixtures/legal-consent-api-methods.mjs";
import { completedBatchIds, expectedMethodCount } from "../tests/fixtures/legal-consent-api-trace-batches.mjs";

const root = process.cwd();
const migrationDirectory = path.join(root, "supabase", "migrations");

export const REQUIRED_FORWARD_MIGRATIONS = [
  ["20260703_moderation_action_notifications.sql", [], ["forum_notifications_type_check", "public.insert_forum_notification", "set search_path = public, pg_temp"]],
  ["20260712_legal_policy_acceptances.sql", [], ["public.legal_policy_acceptances", "legal_policy_acceptances_user_bundle_key", "legal_policy_acceptances_bundle_last_confirmed_idx", "public.record_current_legal_policy_acceptance", "revoke all on function"]],
  ["20260713_comment_creation_circle_authorization.sql", [], ["public.can_create_comment_target", "comments_insert_self", "revoke all on function"]],
  ["20260713_comment_reaction_visibility_authorization.sql", [], ["public.can_access_comment_reaction_target", "comment_reactions_insert_self", "comment_reactions_update_self", "comment_reactions_delete_self"]],
  ["20260713_comment_read_circle_visibility_authorization.sql", [], ["public.can_access_public_circle", "public.can_access_public_comment_read_target", "posts_select_published_public", "comments_select_public_or_staff"]],
  ["20260713_forum_posts_circle_authorization.sql", ["20260713_comment_read_circle_visibility_authorization.sql"], ["posts_insert_self", "posts_update_self_or_staff", "posts_delete_self_or_staff", "public.increment_post_view_count"]],
  ["20260713_forum_report_target_authorization.sql", ["20260713_comment_read_circle_visibility_authorization.sql"], ["public.can_create_user_report_target", "reports_insert_self", "public.can_access_public_circle"]],
  ["20260713_post_bound_media_provenance.sql", [], ["public.is_canonical_post_media_object_key", "public.can_bind_post_media_provenance", "post_media_insert_self", "post_media_update_self_or_staff"]],
  ["20260714_circle_cover_public_visibility_authorization.sql", ["20260713_comment_read_circle_visibility_authorization.sql"], ["public.can_access_public_circle_cover_object", "circles_select_public", "circle_cover_objects_select_public"]],
  ["20260715_post_media_delivery_visibility_authorization.sql", ["20260713_comment_read_circle_visibility_authorization.sql", "20260713_post_bound_media_provenance.sql"], ["public.can_access_public_post_media_object", "post_media_select_public_or_owner", "post_media_objects_select_public_or_owner"]],
  ["20260716_profile_media_delivery_authorization.sql", [], ["public.can_access_public_profile_media_object", "profile_avatar_objects_select_public", "profile_banner_objects_select_public"]],
];

const securityDefinerBlockers = [
  ["20260703_moderation_action_notifications.sql", "public.insert_forum_notification"],
  ["20260713_forum_posts_circle_authorization.sql", "public.increment_post_view_count"],
  ["20260713_forum_report_target_authorization.sql", "public.can_create_user_report_target"],
];
const destructivePatterns = [/\bdrop\s+table\b/i, /\btruncate\b/i, /\bdrop\s+column\b/i, /\bdelete\s+from\b/i, /\bgrant\s+all\b/i];

const requiredFiles = REQUIRED_FORWARD_MIGRATIONS.map(([file]) => file);
const discoveredFiles = (await readdir(migrationDirectory))
  .filter((file) => /^202607(?:03|12|13|14|15|16)_.*\.sql$/.test(file))
  .sort();
assert.deepEqual(discoveredFiles, requiredFiles, "The authored forward migration inventory must be exact and ordered.");

for (const [index, [file, dependencies, fragments]] of REQUIRED_FORWARD_MIGRATIONS.entries()) {
  const source = await readFile(path.join(migrationDirectory, file), "utf8");
  for (const fragment of fragments) assert(source.includes(fragment), `${file} must retain ${fragment}.`);
  for (const dependency of dependencies) assert(requiredFiles.indexOf(dependency) < index, `${file} must follow ${dependency}.`);
  for (const pattern of destructivePatterns) assert(!pattern.test(source), `${file} contains disallowed SQL: ${pattern}.`);
  for (const match of source.matchAll(/create\s+policy\s+"([^"]+)"/gi)) {
    assert(new RegExp(`drop\\s+policy\\s+if\\s+exists\\s+"${match[1]}"`, "i").test(source), `${file} must drop ${match[1]} before recreation.`);
  }
  if (/security\s+definer/i.test(source)) assert(/set\s+search_path\s*=\s*public(?:\s*,\s*pg_temp)?/i.test(source), `${file} must set an explicit SECURITY DEFINER search_path.`);
}

for (const [file, symbol] of securityDefinerBlockers) {
  const source = await readFile(path.join(migrationDirectory, file), "utf8");
  assert(source.includes(symbol), `${file} must define ${symbol}.`);
  assert(!/revoke\s+all\s+on\s+function[\s\S]*?from\s+public/i.test(source), `${symbol} grant contract changed; update the readiness finding before release.`);
}

const legalPolicy = await readFile(path.join(root, "src/lib/legal-policy.ts"), "utf8");
for (const name of ["PUBLIC_LEGAL_OPERATOR_NAME", "PUBLIC_SUPPORT_EMAIL", "PUBLIC_ABUSE_EMAIL", "PUBLIC_PRIVACY_EMAIL", "PUBLIC_IP_EMAIL"]) assert(legalPolicy.includes(name), `${name} is a public launch prerequisite.`);
assert(legalPolicy.includes('bundleVersion: "2026-07"'), "The active legal bundle must remain server-defined.");
const contactPage = await readFile(path.join(root, "src/pages/contact/index.astro"), "utf8");
assert(contactPage.includes("pending configuration") && contactPage.includes("待配置"), "Missing legal contacts must remain explicit and non-fabricated.");

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

console.log(JSON.stringify({ phase4A1: "66/66 traced", phase4A2: "5/5 integrated", phase4B: "37/37 integrated", migrationInventory: "11/11 exact and ordered", staticBlockers: securityDefinerBlockers.map(([, symbol]) => symbol), publicLegalContactVariables: 5, status: "NO_GO", realOperations: 0 }));
