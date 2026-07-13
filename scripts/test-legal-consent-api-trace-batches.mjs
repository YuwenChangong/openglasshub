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
const resendMethodId = "src/pages/api/auth/resend-confirmation.ts#POST";
const circlesMethodIds = ["src/pages/api/forum/circles.ts#GET", "src/pages/api/forum/circles.ts#POST", "src/pages/api/forum/circles.ts#PATCH"];
const circleCommentsMethodIds = ["src/pages/api/forum/circles/[slug]/comments.ts#GET", "src/pages/api/forum/circles/[slug]/comments.ts#PATCH", "src/pages/api/forum/circles/[slug]/comments.ts#DELETE"];
const circleManageMethodIds = ["src/pages/api/forum/circles/[slug]/manage.ts#GET", "src/pages/api/forum/circles/[slug]/manage.ts#PATCH", "src/pages/api/forum/circles/[slug]/manage.ts#DELETE"];
const circlePostsMethodIds = ["src/pages/api/forum/circles/[slug]/posts.ts#GET", "src/pages/api/forum/circles/[slug]/posts.ts#PATCH", "src/pages/api/forum/circles/[slug]/posts.ts#DELETE"];
const commentReactionBlocker = methodTraceFixture.releaseBlockingFindings.find((finding) => finding?.id === "COMMENT_REACTION_PARENT_POST_VISIBILITY_AUTHORIZATION");
const commentPutBlockerTrace = methodTraceFixture.batch4dBlockerEvidence?.["src/pages/api/forum/comments.ts#PUT"];
const resolvedResendFinding = methodTraceFixture.resolvedSecurityFindings.find((finding) => finding?.id === "RESEND_CONFIRMATION_EXTERNAL_REDIRECT");

assert.equal(batches.length, expectedBatchCount);
assert.equal(assigned.length, expectedMethodCount);
assert.equal(new Set(assigned).size, expectedMethodCount);
assert.deepEqual([...assigned].sort(), [...methodIds].sort());
assert.deepEqual(representatives.filter((id) => !assigned.includes(id)), []);
assert(batches.every((batch) => (completedBatchIds.has(batch.id) ? batch.status === "complete" : batch.status === "pending") && batch.methodCount > 0));
assert.equal(new Set(completeTraceIds).size, 42);
assert.equal(expectedMethodCount - new Set(completeTraceIds).size, 24);
assert.equal(batch3?.status, "complete");
assert.equal(batch4?.status, "pending");
assert.equal(fileTraceProgress["src/pages/api/auth/resend-confirmation.ts"]?.status, "complete");
assert.equal(fileTraceProgress["src/pages/api/forum/circles.ts"]?.status, "complete");
assert.equal(fileTraceProgress["src/pages/api/forum/circles/[slug]/comments.ts"]?.status, "complete");
assert.equal(fileTraceProgress["src/pages/api/forum/circles/[slug]/manage.ts"]?.status, "complete");
assert.equal(fileTraceProgress["src/pages/api/forum/circles/[slug]/posts.ts"]?.status, "complete");
assert.equal(fileTraceProgress["src/pages/api/forum/comments.ts"]?.status, "blocked");
assert.equal(fileTraceProgress["src/pages/api/forum/comments.ts"]?.blockedMethodId, "src/pages/api/forum/comments.ts#PUT");
assert.equal(commentPutBlockerTrace?.traceStatus, "blocked");
assert.equal(commentPutBlockerTrace?.traceEvidenceComplete, false);
assert.equal(commentReactionBlocker?.routeEvidence?.symbol, "PUT");
assert.equal(commentReactionBlocker?.rlsEvidence?.symbol, "comment_reactions_insert_self");
assert.equal(commentReactionBlocker?.mismatchEvidence?.symbol, "GET");
assert.equal(commentReactionBlocker?.singleLayerFixInsufficient, true);
assert.equal(commentReactionBlocker?.requiresRuntimeRemediation, true);
assert.equal(commentReactionBlocker?.requiresForwardMigrationRemediation, true);
assert.equal(commentReactionBlocker?.consentDoesNotRemediateAuthorization, true);
assert.equal(fileTraceProgress["src/pages/api/auth/resend-confirmation.ts"]?.blockerId, undefined);
assert.equal(resolvedResendFinding?.status, "resolved");
assert.equal(resolvedResendFinding?.remediationCommit, "eb92faf98dd0dd60c10fb6d770781b3a99c1e604");
assert(completeTraceIds.includes(resendMethodId));
assert.deepEqual(circlesMethodIds.filter((id) => completeTraceIds.includes(id)), circlesMethodIds);
assert.deepEqual(circleCommentsMethodIds.filter((id) => completeTraceIds.includes(id)), circleCommentsMethodIds);
assert.deepEqual(circleManageMethodIds.filter((id) => completeTraceIds.includes(id)), circleManageMethodIds);
assert.deepEqual(circlePostsMethodIds.filter((id) => completeTraceIds.includes(id)), circlePostsMethodIds);
assert.deepEqual(batch3?.methodIds.filter((id) => completeTraceIds.includes(id)), ["src/pages/api/admin/users.ts#GET", "src/pages/api/admin/users/[id]/ban.ts#POST", "src/pages/api/admin/users/[id]/clear-warning.ts#POST", "src/pages/api/admin/users/[id]/safety.ts#GET", "src/pages/api/admin/users/[id]/suspend.ts#POST", "src/pages/api/admin/users/[id]/unban.ts#POST", "src/pages/api/admin/users/[id]/warn.ts#POST", "src/pages/api/auth/resend-confirmation.ts#POST", ...circlesMethodIds]);
assert.deepEqual(batch4?.methodIds.filter((id) => completeTraceIds.includes(id)), [...circleCommentsMethodIds, ...circleManageMethodIds, ...circlePostsMethodIds]);

console.log(JSON.stringify({ expectedBatchCount, actualBatchCount: batches.length, expectedMethodCount, assignedMethodCount: assigned.length, tracedMethodCount: new Set(completeTraceIds).size, pendingMethodCount: expectedMethodCount - new Set(completeTraceIds).size, missingMethodIds: [], duplicateMethodIds: [], unknownMethodIds: [], unassignedRepresentativeMethodIds: [], releaseBlockingFindings: methodTraceFixture.releaseBlockingFindings, resolvedSecurityFindings: methodTraceFixture.resolvedSecurityFindings, batches }));
