import crypto from "node:crypto";

export const CANARY_APPROVAL = "APPROVE_R6Y_BUILD_CRASH_SAFE_MINIMAL_PRODUCTION_CANARY_AND_COMPLETE_R6";
export const JOURNAL_SCHEMA_VERSION = 1;
export const JOURNAL_STATES = new Set([
  "PLANNED", "AUTHENTICATED", "POST_CREATE_SENT", "POST_CONFIRMED", "COMMENT_CREATE_SENT",
  "COMMENT_CONFIRMED", "VERIFYING", "CLEANUP_COMMENT", "CLEANUP_POST", "RESIDUE_CHECK",
  "COMPLETE", "RECOVERY_REQUIRED", "BLOCKED_AMBIGUOUS_RESULT",
]);

export function generateCanaryRunId() {
  return `qa-canary-${crypto.randomUUID()}`;
}

export function validateCanaryRunId(value) {
  const runId = String(value ?? "").trim();
  if (!/^qa-canary-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) {
    throw new Error("QA_CANARY_RUN_ID_INVALID");
  }
  return runId;
}

export function createMarkers(runId) {
  const entropy = crypto.randomBytes(16).toString("hex");
  return { post: `qa-canary-post-${runId}-${entropy}`, comment: `qa-canary-comment-${runId}-${entropy}` };
}

export function createJournal({ runId, target, qaUserId, expectedCommit, markers, now = new Date().toISOString() }) {
  validateCanaryRunId(runId);
  return {
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    runId,
    approval: CANARY_APPROVAL,
    startedAt: now,
    expectedCommit: String(expectedCommit ?? "").trim(),
    target: { baseUrl: target.baseUrl, supabaseRef: target.supabaseRef },
    qaUserId,
    scope: ["post", "comment"],
    markers,
    state: "PLANNED",
    cleanup: { comment: "PENDING", post: "PENDING", residue: "PENDING" },
    recoveryConfirmations: [],
    artifacts: { post: null, comment: null },
    history: [{ state: "PLANNED", at: now }],
  };
}

export function validateJournal(journal) {
  if (!journal || journal.schemaVersion !== JOURNAL_SCHEMA_VERSION || journal.approval !== CANARY_APPROVAL) throw new Error("QA_CANARY_JOURNAL_SCHEMA_INVALID");
  validateCanaryRunId(journal.runId);
  if (!JOURNAL_STATES.has(journal.state) || !Array.isArray(journal.scope) || journal.scope.join(",") !== "post,comment") throw new Error("QA_CANARY_JOURNAL_SCOPE_INVALID");
  if (!journal.target?.baseUrl || !journal.target?.supabaseRef || !journal.qaUserId || !journal.markers?.post || !journal.markers?.comment) throw new Error("QA_CANARY_JOURNAL_IDENTITY_INVALID");
  return journal;
}

export async function transition(store, journal, state, patch = {}) {
  if (!JOURNAL_STATES.has(state)) throw new Error("QA_CANARY_JOURNAL_STATE_INVALID");
  const next = { ...journal, ...patch, state, history: [...journal.history, { state, at: new Date().toISOString() }] };
  await store.write(next);
  return next;
}

function assertArtifact(kind, artifact, journal) {
  if (!artifact?.id || artifact.ownerId !== journal.qaUserId || artifact.marker !== journal.markers[kind]) {
    throw new Error(`QA_CANARY_${kind.toUpperCase()}_IDENTITY_MISMATCH`);
  }
  if (kind === "comment" && artifact.postId !== journal.artifacts.post?.id) throw new Error("QA_CANARY_COMMENT_PARENT_MISMATCH");
}

async function recoverOne(adapter, journal, kind) {
  const matches = await (kind === "post"
    ? adapter.findPostByMarker({ marker: journal.markers.post, ownerId: journal.qaUserId, startedAt: journal.startedAt })
    : adapter.findCommentByMarker({ marker: journal.markers.comment, ownerId: journal.qaUserId, postId: journal.artifacts.post?.id, startedAt: journal.startedAt }));
  if (!Array.isArray(matches)) throw new Error("QA_CANARY_RECOVERY_LOOKUP_INVALID");
  if (matches.length > 1) throw new Error("QA_CANARY_AMBIGUOUS_MULTIPLE_MATCHES");
  return matches[0] ?? null;
}

async function cleanup(adapter, store, journal) {
  let next = journal;
  if (next.artifacts.comment) {
    assertArtifact("comment", next.artifacts.comment, next);
    next = await transition(store, next, "CLEANUP_COMMENT");
    await adapter.deleteComment(next.artifacts.comment);
    if (!(await adapter.verifyCommentAbsent(next.artifacts.comment))) throw new Error("QA_CANARY_COMMENT_RESIDUE");
    next = await transition(store, next, "CLEANUP_COMMENT", { cleanup: { ...next.cleanup, comment: "CLEAN" } });
  }
  if (next.artifacts.post) {
    assertArtifact("post", next.artifacts.post, next);
    next = await transition(store, next, "CLEANUP_POST");
    await adapter.deletePost(next.artifacts.post);
    if (!(await adapter.verifyPostAbsent(next.artifacts.post))) throw new Error("QA_CANARY_POST_RESIDUE");
    next = await transition(store, next, "CLEANUP_POST", { cleanup: { ...next.cleanup, post: "CLEAN" } });
  }
  next = await transition(store, next, "RESIDUE_CHECK");
  const residue = await adapter.verifyResidue({ ...next.artifacts, markers: next.markers, ownerId: next.qaUserId });
  if (residue?.ok !== true) throw new Error("QA_CANARY_RESIDUE_DETECTED");
  return transition(store, next, "COMPLETE", { cleanup: { ...next.cleanup, residue: "ZERO_RESIDUE" } });
}

export async function executeMinimalCanary({ adapter, store, journal }) {
  validateJournal(journal);
  await store.write(journal); // Write-ahead journal must exist before auth or mutation.
  let next = journal;
  try {
    const actor = await adapter.authenticate();
    if (!actor || actor.id !== next.qaUserId) throw new Error("QA_CANARY_ACCOUNT_MISMATCH");
    next = await transition(store, next, "AUTHENTICATED");

    next = await transition(store, next, "POST_CREATE_SENT");
    let post;
    try { post = await adapter.createPost({ marker: next.markers.post }); }
    catch (error) {
      if (!error?.ambiguous) throw error;
      post = await recoverOne(adapter, next, "post");
      if (!post) throw new Error("QA_CANARY_POST_AMBIGUOUS_NO_MATCH");
    }
    assertArtifact("post", post, next);
    next = await transition(store, next, "POST_CONFIRMED", { artifacts: { ...next.artifacts, post } });
    if (!(await adapter.verifyPost(post))) throw new Error("QA_CANARY_POST_VERIFY_FAILED");

    next = await transition(store, next, "COMMENT_CREATE_SENT");
    let comment;
    try { comment = await adapter.createComment({ marker: next.markers.comment, postId: post.id }); }
    catch (error) {
      if (!error?.ambiguous) throw error;
      comment = await recoverOne(adapter, next, "comment");
      if (!comment) throw new Error("QA_CANARY_COMMENT_AMBIGUOUS_NO_MATCH");
    }
    assertArtifact("comment", comment, next);
    next = await transition(store, next, "COMMENT_CONFIRMED", { artifacts: { ...next.artifacts, comment } });
    if (!(await adapter.verifyComment(comment))) throw new Error("QA_CANARY_COMMENT_VERIFY_FAILED");
    next = await transition(store, next, "VERIFYING");
    return await cleanup(adapter, store, next);
  } catch (error) {
    if (error?.crash === true) throw error;
    await transition(store, next, error?.message?.includes("AMBIGUOUS") ? "BLOCKED_AMBIGUOUS_RESULT" : "RECOVERY_REQUIRED").catch(() => undefined);
    throw error;
  }
}

export async function recoverMinimalCanary({ adapter, store, journal, recoveryConfirmationHash }) {
  validateJournal(journal);
  if (journal.state === "COMPLETE") return { journal, alreadyClean: true };
  if (!/^[a-f0-9]{64}$/i.test(String(recoveryConfirmationHash ?? "")) || journal.recoveryConfirmations?.includes(recoveryConfirmationHash)) {
    throw new Error("QA_CANARY_RECOVERY_CONFIRMATION_INVALID");
  }
  const actor = await adapter.authenticate();
  if (!actor || actor.id !== journal.qaUserId) throw new Error("QA_CANARY_ACCOUNT_MISMATCH");
  const originalState = journal.state;
  let next = await transition(store, journal, "RECOVERY_REQUIRED", { recoveryConfirmations: [...(journal.recoveryConfirmations ?? []), recoveryConfirmationHash] });
  if (!next.artifacts.post && ["POST_CREATE_SENT", "POST_CONFIRMED", "COMMENT_CREATE_SENT", "COMMENT_CONFIRMED", "VERIFYING", "CLEANUP_COMMENT", "CLEANUP_POST", "RESIDUE_CHECK", "RECOVERY_REQUIRED", "BLOCKED_AMBIGUOUS_RESULT"].includes(originalState)) {
    const post = await recoverOne(adapter, next, "post");
    if (post) { assertArtifact("post", post, next); next = await transition(store, next, "POST_CONFIRMED", { artifacts: { ...next.artifacts, post } }); }
  }
  if (next.artifacts.post && !next.artifacts.comment && ["COMMENT_CREATE_SENT", "COMMENT_CONFIRMED", "VERIFYING", "CLEANUP_COMMENT", "CLEANUP_POST", "RESIDUE_CHECK", "RECOVERY_REQUIRED", "BLOCKED_AMBIGUOUS_RESULT"].includes(originalState)) {
    const comment = await recoverOne(adapter, next, "comment");
    if (comment) { assertArtifact("comment", comment, next); next = await transition(store, next, "COMMENT_CONFIRMED", { artifacts: { ...next.artifacts, comment } }); }
  }
  return { journal: await cleanup(adapter, store, next), alreadyClean: false };
}
