import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { buildTraceBatches, completedBatchIds, expectedBatchCount, expectedMethodCount, fileTraceProgress } from "../tests/fixtures/legal-consent-api-trace-batches.mjs";
import * as methodTraceFixture from "../tests/fixtures/legal-consent-api-methods.mjs";

const root = process.cwd();

async function walk(dir) {
  const items = await fs.readdir(dir, { withFileTypes: true });
  return (await Promise.all(items.map((item) => (item.isDirectory() ? walk(path.join(dir, item.name)) : [path.join(dir, item.name)])))).flat();
}

const files = (await walk(path.join(root, "src/pages/api"))).filter((file) => file.endsWith(".ts"));
const methodIds = [];
for (const file of files) {
  const source = await fs.readFile(file, "utf8");
  for (const match of source.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\s*:/g)) {
    methodIds.push(`${path.relative(root, file).replaceAll("\\", "/")}#${match[1]}`);
  }
}

const representatives = ["src/pages/api/forum/comments.ts#POST", "src/pages/api/forum/posts.ts#POST", "src/pages/api/users/me/profile.ts#POST", "src/pages/api/admin/moderation/hide.ts#POST", "src/pages/api/forum/reports.ts#POST"];
const batches = buildTraceBatches(methodIds, representatives);
const assigned = batches.flatMap((batch) => batch.methodIds);
const completeTraceIds = Object.values(methodTraceFixture)
  .filter((value) => value && typeof value === "object" && !Array.isArray(value))
  .flatMap((value) => Object.entries(value).filter(([, entry]) => entry && entry.traceStatus === "complete").map(([id]) => id));
const batch3 = batches.find((batch) => batch.id === "phase4a1-trace-batch-3");
const batch4 = batches.find((batch) => batch.id === "phase4a1-trace-batch-4");
const batch5 = batches.find((batch) => batch.id === "phase4a1-trace-batch-5");
const batch6 = batches.find((batch) => batch.id === "phase4a1-trace-batch-6");
const resendMethodId = "src/pages/api/auth/resend-confirmation.ts#POST";
const circlesMethodIds = ["src/pages/api/forum/circles.ts#GET", "src/pages/api/forum/circles.ts#POST", "src/pages/api/forum/circles.ts#PATCH"];
const circleCommentsMethodIds = ["src/pages/api/forum/circles/[slug]/comments.ts#GET", "src/pages/api/forum/circles/[slug]/comments.ts#PATCH", "src/pages/api/forum/circles/[slug]/comments.ts#DELETE"];
const circleManageMethodIds = ["src/pages/api/forum/circles/[slug]/manage.ts#GET", "src/pages/api/forum/circles/[slug]/manage.ts#PATCH", "src/pages/api/forum/circles/[slug]/manage.ts#DELETE"];
const circlePostsMethodIds = ["src/pages/api/forum/circles/[slug]/posts.ts#GET", "src/pages/api/forum/circles/[slug]/posts.ts#PATCH", "src/pages/api/forum/circles/[slug]/posts.ts#DELETE"];
const resolvedCommentReaction = methodTraceFixture.resolvedSecurityFindings.find((finding) => finding?.id === "COMMENT_REACTION_PARENT_POST_VISIBILITY_AUTHORIZATION");
const commentPutTrace = methodTraceFixture.batch4dTraces?.["src/pages/api/forum/comments.ts#PUT"];
const resolvedCommentCreation = methodTraceFixture.resolvedSecurityFindings.find((finding) => finding?.id === "COMMENT_CREATION_CIRCLE_ANCESTOR_AUTHORIZATION");
const commentPostTrace = methodTraceFixture.batch4eTraces?.["src/pages/api/forum/comments.ts#POST"];
const commentGetBlocker = methodTraceFixture.releaseBlockingFindings.find((finding) => finding?.id === "COMMENT_READ_CIRCLE_ANCESTOR_VISIBILITY_AUTHORIZATION");
const resolvedResendFinding = methodTraceFixture.resolvedSecurityFindings.find((finding) => finding?.id === "RESEND_CONFIRMATION_EXTERNAL_REDIRECT");

assert.equal(batches.length, expectedBatchCount);
assert.equal(assigned.length, expectedMethodCount);
assert.equal(new Set(assigned).size, expectedMethodCount);
assert.deepEqual([...assigned].sort(), [...methodIds].sort());
assert.deepEqual(representatives.filter((id) => !assigned.includes(id)), []);
assert(batches.every((batch) => (completedBatchIds.has(batch.id) ? batch.status === "complete" : batch.status === "pending") && batch.methodCount > 0));
assert.equal(new Set(completeTraceIds).size, 44);
assert.equal(expectedMethodCount - new Set(completeTraceIds).size, 22);
assert.equal(batch3?.status, "complete");
assert.equal(batch4?.status, "pending");
assert.equal(batch5?.status, "pending");
assert.equal(batch6?.status, "pending");
assert.deepEqual(batches.slice(0, 3).map((batch) => batch.status), ["complete", "complete", "complete"]);
assert.equal(fileTraceProgress["src/pages/api/auth/resend-confirmation.ts"]?.status, "complete");
assert.equal(fileTraceProgress["src/pages/api/forum/circles.ts"]?.status, "complete");
assert.equal(fileTraceProgress["src/pages/api/forum/circles/[slug]/comments.ts"]?.status, "complete");
assert.equal(fileTraceProgress["src/pages/api/forum/circles/[slug]/manage.ts"]?.status, "complete");
assert.equal(fileTraceProgress["src/pages/api/forum/circles/[slug]/posts.ts"]?.status, "complete");
assert.equal(fileTraceProgress["src/pages/api/forum/comments.ts"]?.status, "partial");
assert.deepEqual(fileTraceProgress["src/pages/api/forum/comments.ts"]?.completedMethodIds, ["src/pages/api/forum/comments.ts#POST"]);
assert.deepEqual(fileTraceProgress["src/pages/api/forum/comments.ts"]?.pendingMethodIds, ["src/pages/api/forum/comments.ts#GET"]);
assert.equal(fileTraceProgress["src/pages/api/forum/comments.ts"]?.blockerId, "COMMENT_READ_CIRCLE_ANCESTOR_VISIBILITY_AUTHORIZATION");
assert.equal(fileTraceProgress["src/pages/api/forum/comments.ts"]?.getRuntimeRemediationStatus, "implemented-source-awaiting-get-reaudit");
assert.equal(fileTraceProgress["src/pages/api/forum/comments.ts"]?.getForwardMigration, "supabase/migrations/20260713_comment_read_circle_visibility_authorization.sql");
assert.equal(fileTraceProgress["src/pages/api/forum/comments.ts"]?.getForwardMigrationStatus, "authored-not-executed");
assert.equal(fileTraceProgress["src/pages/api/forum/comments.ts"]?.getReauditRequired, true);
assert.equal(fileTraceProgress["src/pages/api/forum/comments.ts"]?.reAuditedMethodId, "src/pages/api/forum/comments.ts#PUT");
assert.equal(fileTraceProgress["src/pages/api/forum/comments.ts"]?.migrationExecutionStatus, "authored-not-executed");
assert.equal(commentPutTrace?.traceStatus, "complete");
assert.equal(commentPutTrace?.traceEvidenceComplete, true);
assert.equal(commentPutTrace?.traceCompleteness, "complete");
assert.equal(commentPutTrace?.migrationExecutionStatus, "authored-not-executed");
assert.equal(methodTraceFixture.releaseBlockingFindings.length, 1);
assert.equal(commentGetBlocker?.status, "active");
assert.equal(commentGetBlocker?.sourceFile, "src/pages/api/forum/comments.ts");
assert.equal(commentGetBlocker?.method, "GET");
assert.equal(commentGetBlocker?.routeEvidence?.symbol, "GET");
assert.equal(commentGetBlocker?.postRlsEvidence?.symbol, "posts_select_published_public");
assert.equal(commentGetBlocker?.commentRlsEvidence?.symbol, "comments_select_public_or_staff");
assert.equal(commentGetBlocker?.requiresRuntimeRemediation, true);
assert.equal(commentGetBlocker?.requiresForwardMigrationRemediation, true);
assert.equal(commentGetBlocker?.singleLayerFixInsufficient, true);
assert.equal(commentGetBlocker?.consentDoesNotRemediateAuthorization, true);
assert.equal(commentGetBlocker?.runtimeRemediationStatus, "implemented-source-awaiting-get-reaudit");
assert.equal(commentGetBlocker?.forwardMigration, "supabase/migrations/20260713_comment_read_circle_visibility_authorization.sql");
assert.equal(commentGetBlocker?.forwardMigrationStatus, "authored-not-executed");
assert(commentGetBlocker?.evidence?.every((entry) => entry.sourceFile && entry.symbol && entry.evidenceType && entry.conciseFinding));
assert.equal(resolvedCommentCreation?.status, "resolved-source-awaiting-deployment");
assert.equal(resolvedCommentCreation?.remediationCommit, "485215b2c311a0347258c5618db4db5326f84a58");
assert.equal(resolvedCommentCreation?.migrationExecutionStatus, "authored-not-executed");
assert.equal(commentPostTrace?.traceStatus, "complete");
assert.equal(commentPostTrace?.traceEvidenceComplete, true);
assert.equal(commentPostTrace?.traceCompleteness, "complete");
assert.equal(commentPostTrace?.migrationExecutionStatus, "authored-not-executed");
assert.equal(resolvedCommentReaction?.status, "resolved-source-awaiting-deployment");
assert.equal(resolvedCommentReaction?.remediationCommit, "d57aae680fb81ed4133af73aae955473218d9c09");
assert.equal(fileTraceProgress["src/pages/api/auth/resend-confirmation.ts"]?.blockerId, undefined);
assert.equal(resolvedResendFinding?.status, "resolved");
assert.equal(resolvedResendFinding?.remediationCommit, "eb92faf98dd0dd60c10fb6d770781b3a99c1e604");
assert(completeTraceIds.includes(resendMethodId));
assert(completeTraceIds.includes("src/pages/api/forum/comments.ts#PUT"));
assert(!completeTraceIds.includes("src/pages/api/forum/comments.ts#GET"));
assert(completeTraceIds.includes("src/pages/api/forum/comments.ts#POST"));
assert(!completeTraceIds.includes("src/pages/api/forum/comments.ts#DELETE"));
assert.deepEqual(circlesMethodIds.filter((id) => completeTraceIds.includes(id)), circlesMethodIds);
assert.deepEqual(circleCommentsMethodIds.filter((id) => completeTraceIds.includes(id)), circleCommentsMethodIds);
assert.deepEqual(circleManageMethodIds.filter((id) => completeTraceIds.includes(id)), circleManageMethodIds);
assert.deepEqual(circlePostsMethodIds.filter((id) => completeTraceIds.includes(id)), circlePostsMethodIds);
assert.deepEqual(batch3?.methodIds.filter((id) => completeTraceIds.includes(id)), ["src/pages/api/admin/users.ts#GET", "src/pages/api/admin/users/[id]/ban.ts#POST", "src/pages/api/admin/users/[id]/clear-warning.ts#POST", "src/pages/api/admin/users/[id]/safety.ts#GET", "src/pages/api/admin/users/[id]/suspend.ts#POST", "src/pages/api/admin/users/[id]/unban.ts#POST", "src/pages/api/admin/users/[id]/warn.ts#POST", "src/pages/api/auth/resend-confirmation.ts#POST", ...circlesMethodIds]);
assert.deepEqual(batch4?.methodIds.filter((id) => completeTraceIds.includes(id)), [...circleCommentsMethodIds, ...circleManageMethodIds, ...circlePostsMethodIds, "src/pages/api/forum/comments.ts#POST"]);

console.log(JSON.stringify({ expectedBatchCount, actualBatchCount: batches.length, expectedMethodCount, assignedMethodCount: assigned.length, tracedMethodCount: new Set(completeTraceIds).size, pendingMethodCount: expectedMethodCount - new Set(completeTraceIds).size, missingMethodIds: [], duplicateMethodIds: [], unknownMethodIds: [], unassignedRepresentativeMethodIds: [], releaseBlockingFindings: methodTraceFixture.releaseBlockingFindings, resolvedSecurityFindings: methodTraceFixture.resolvedSecurityFindings, batches }));
