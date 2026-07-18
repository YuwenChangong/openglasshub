import crypto from "node:crypto";

export const CANARY_APPROVAL = "APPROVE_R6_HARDENED_WRITE_AHEAD_FRESH_ATTESTATION_AUTH_DRY_RUN_AND_CANARY_EXECUTION";
export const RECOVERY_APPROVAL = "APPROVE_R6_HARDENED_RECOVERY_ONLY";
export const JOURNAL_SCHEMA_VERSION = 2;
export const CANONICAL_ENCODING_VERSION = "utf8-nfc-v1";
export const POST_TEMPLATE_VERSION = "r6-post-v2";
export const COMMENT_TEMPLATE_VERSION = "r6-comment-v2";
export const RECOVERY_QUERY_CONTRACT_VERSION = "exact-v2";
export const PAGINATION_CONTRACT_VERSION = "complete-total-count-v1";
export const JOURNAL_STATES = new Set([
  "PREPARED", "AUTHENTICATED", "POST_SUBMISSION_PENDING", "POST_SUBMISSION_AMBIGUOUS", "POST_CONFIRMED",
  "COMMENT_SUBMISSION_PENDING", "COMMENT_SUBMISSION_AMBIGUOUS", "COMMENT_CONFIRMED", "RECOVERY_ONLY",
  "POST_ADOPTED", "COMMENT_ADOPTED", "CLEANUP_COMMENT", "CLEANUP_POST", "RESIDUE_CHECK", "COMPLETE", "BLOCKED",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const now = () => new Date().toISOString();

export function generateCanaryRunId() { return `qa-canary-${crypto.randomUUID()}`; }
export function validateCanaryRunId(value) { const runId = String(value ?? "").trim(); if (!/^qa-canary-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) throw new Error("QA_CANARY_RUN_ID_INVALID"); return runId; }
export function createMarkers(runId) { const entropy = crypto.randomBytes(16).toString("hex"); return { post: `qa-canary-post-${runId}-${entropy}`, comment: `qa-canary-comment-${runId}-${entropy}` }; }
export function contentFor(markers) { return { title: `Temporary automated QA ${markers.post}`, body: `Temporary automated QA validation ${markers.post}`, comment: `Temporary automated QA validation ${markers.comment}` }; }

function require(value, code) { if (!value) throw new Error(code); return value; }
function assertUuid(value, code) { if (!UUID.test(String(value ?? ""))) throw new Error(code); return String(value); }
function assertHash(value, code) { if (!/^[a-f0-9]{64}$/i.test(String(value ?? ""))) throw new Error(code); return String(value); }
function assertPrepared(prepared, { recovery = false } = {}) {
  if (!prepared || typeof prepared !== "object") throw new Error("QA_CANARY_PREPARED_REQUIRED");
  assertUuid(prepared.actorId, "QA_CANARY_ACTOR_REQUIRED"); assertUuid(prepared.circleId, "QA_CANARY_CIRCLE_ID_REQUIRED");
  if (!String(prepared.circleSlug ?? "").trim() || prepared.circleSlug !== prepared.resolvedCircleSlug) throw new Error("QA_CANARY_CIRCLE_SCOPE_MISMATCH");
  for (const key of ["runnerCommit", "attestationSha256", "deploymentId", "deployedCommit", "baseUrl", "supabaseRefDigest", "postMarker", "commentMarker", "postTitleSha256", "postBodySha256", "commentBodySha256", "encodingVersion", "postTemplateVersion", "commentTemplateVersion", "recoveryQueryContractVersion", "paginationContractVersion"]) require(prepared[key], `QA_CANARY_PREPARED_${key.toUpperCase()}_REQUIRED`);
  assertHash(prepared.attestationSha256, "QA_CANARY_ATTESTATION_HASH_INVALID");
  for (const key of ["postTitleSha256", "postBodySha256", "commentBodySha256"]) assertHash(prepared[key], `QA_CANARY_PREPARED_${key.toUpperCase()}_INVALID`);
  if (!Number.isInteger(prepared.requestTimeoutMs) || prepared.requestTimeoutMs < 1000 || prepared.requestTimeoutMs > 120000) throw new Error("QA_CANARY_TIMEOUT_INVALID");
  const expectedRecovery = recovery ? [false, true] : [true, false];
  if (prepared.creationEnabled !== expectedRecovery[0] || prepared.recoveryOnly !== expectedRecovery[1] || prepared.plannedPostCount !== 1 || prepared.plannedCommentCount !== 1 || prepared.cleanupOrder !== "comment-then-post" || prepared.networkRetryPolicy !== "zero") throw new Error("QA_CANARY_PREPARED_SCOPE_INVALID");
}

export function createJournal({ runId, prepared, markers = createMarkers(runId), now: createdAt = now() }) {
  validateCanaryRunId(runId); assertPrepared(prepared);
  const content = contentFor(markers);
  if (prepared.postMarker !== markers.post || prepared.commentMarker !== markers.comment || prepared.postTitleSha256 !== sha256(content.title) || prepared.postBodySha256 !== sha256(content.body) || prepared.commentBodySha256 !== sha256(content.comment)) throw new Error("QA_CANARY_PREPARED_CONTENT_MISMATCH");
  return { schemaVersion: JOURNAL_SCHEMA_VERSION, runId, approval: CANARY_APPROVAL, state: "PREPARED", preparedAt: createdAt, prepared, markers, attempts: { post: null, comment: null }, artifacts: { post: null, comment: null }, cleanup: { comment: "PENDING", post: "PENDING", residue: "PENDING" }, recovery: { candidateClassification: null, adopted: false }, history: [{ state: "PREPARED", at: createdAt }] };
}

export function validateJournal(journal) {
  if (!journal || journal.schemaVersion !== JOURNAL_SCHEMA_VERSION || journal.approval !== CANARY_APPROVAL || !JOURNAL_STATES.has(journal.state)) throw new Error("QA_CANARY_JOURNAL_SCHEMA_INVALID");
  validateCanaryRunId(journal.runId); assertPrepared(journal.prepared, { recovery: journal.prepared?.recoveryOnly === true });
  if (!journal.markers?.post || !journal.markers?.comment || !journal.attempts || !journal.artifacts || !journal.cleanup || !journal.recovery) throw new Error("QA_CANARY_JOURNAL_SCOPE_INVALID");
  return journal;
}

export async function transition(store, journal, state, patch = {}) { if (!JOURNAL_STATES.has(state)) throw new Error("QA_CANARY_JOURNAL_STATE_INVALID"); const next = { ...journal, ...patch, state, history: [...journal.history, { state, at: now() }] }; await store.write(next); const reread = await store.read(); if (reread.state !== state || reread.runId !== next.runId) throw new Error("QA_CANARY_JOURNAL_REREAD_MISMATCH"); return reread; }
function assertArtifact(kind, artifact, journal) { if (!artifact?.id || artifact.ownerId !== journal.prepared.actorId || artifact.marker !== journal.markers[kind]) throw new Error(`QA_CANARY_${kind.toUpperCase()}_IDENTITY_MISMATCH`); if (kind === "comment" && artifact.postId !== journal.artifacts.post?.id) throw new Error("QA_CANARY_COMMENT_PARENT_MISMATCH"); }
function operationId(runId, operation) { return sha256(`${runId}|${operation}`).slice(0, 32); }
function attempt(kind, journal) { const marker = journal.markers[kind]; const content = contentFor(journal.markers); return { operation: kind === "post" ? "CREATE_POST" : "CREATE_COMMENT", number: 1, operationId: operationId(journal.runId, kind.toUpperCase()), method: "POST", route: kind === "post" ? "/api/forum/posts" : "/api/forum/comments", payloadSha256: sha256(kind === "post" ? JSON.stringify({ circle_id: journal.prepared.circleId, type: "feedback", title: content.title, body: content.body }) : JSON.stringify({ post_id: journal.artifacts.post?.id, body: content.comment })), marker, titleSha256: kind === "post" ? sha256(content.title) : null, bodySha256: kind === "post" ? sha256(content.body) : sha256(content.comment), actorId: journal.prepared.actorId, circleId: journal.prepared.circleId, circleSlug: journal.prepared.circleSlug, requestStartedAt: now(), monotonicStartedMs: performance.now(), timeoutMs: journal.prepared.requestTimeoutMs, retryPolicy: "zero", state: "SUBMISSION_PENDING" }; }

async function submit(kind, adapter, store, journal) {
  const record = attempt(kind, journal); const withAttempt = await transition(store, journal, kind === "post" ? "POST_SUBMISSION_PENDING" : "COMMENT_SUBMISSION_PENDING", { attempts: { ...journal.attempts, [kind]: record } });
  if (withAttempt.attempts[kind]?.state !== "SUBMISSION_PENDING") throw new Error("QA_CANARY_ATTEMPT_PERSISTENCE_INVALID");
  try {
    const artifact = kind === "post"
      ? await adapter.createPost({ marker: withAttempt.markers.post, attempt: record, prepared: withAttempt.prepared })
      : await adapter.createComment({ marker: withAttempt.markers.comment, postId: withAttempt.artifacts.post.id, attempt: record, prepared: withAttempt.prepared });
    assertArtifact(kind, artifact, withAttempt);
    return transition(store, withAttempt, kind === "post" ? "POST_CONFIRMED" : "COMMENT_CONFIRMED", {
      artifacts: { ...withAttempt.artifacts, [kind]: artifact },
      attempts: { ...withAttempt.attempts, [kind]: { ...record, state: "RESPONSE_CONFIRMED", responseAt: now(), returnedId: artifact.id, responseSha256: sha256(JSON.stringify(artifact)) } },
    });
  }
  catch (error) {
    const ambiguous = error?.ambiguous === true;
    await transition(store, withAttempt, ambiguous ? (kind === "post" ? "POST_SUBMISSION_AMBIGUOUS" : "COMMENT_SUBMISSION_AMBIGUOUS") : "BLOCKED", {
      attempts: { ...withAttempt.attempts, [kind]: { ...record, state: ambiguous ? "POTENTIALLY_SUBMITTED" : "REJECTED", errorObservedAt: now(), headersReceived: Boolean(error?.headersReceived), statusReceived: Boolean(error?.status), responseBytesReceived: Boolean(error?.responseBytes), transportClassification: String(error?.message ?? "QA_CANARY_REQUEST_FAILED") } },
    });
    throw error;
  }
}

export async function executeMinimalCanary({ adapter, store, journal }) {
  validateJournal(journal); const prepared = await store.read(); validateJournal(prepared); if (prepared.state !== "PREPARED" || prepared.prepared.creationEnabled !== true || prepared.prepared.recoveryOnly !== false) throw new Error("QA_CANARY_CREATION_NOT_PREPARED");
  const postJournal = await submit("post", adapter, store, prepared); if (!postJournal.artifacts.post?.id) throw new Error("QA_CANARY_POST_NOT_DURABLE");
  const rereadPost = await store.read(); if (rereadPost.artifacts.post?.id !== postJournal.artifacts.post.id) throw new Error("QA_CANARY_POST_REREAD_MISMATCH");
  const commentJournal = await submit("comment", adapter, store, rereadPost);
  const withComment = await store.read();
  if (withComment.artifacts.comment?.id !== commentJournal.artifacts.comment?.id) throw new Error("QA_CANARY_COMMENT_REREAD_MISMATCH");
  return cleanupMinimalCanary({ adapter, store, journal: withComment });
}

async function cleanupMinimalCanary({ adapter, store, journal }) {
  const comment = journal.artifacts.comment;
  const post = journal.artifacts.post;
  if (!comment?.id || !post?.id) throw new Error("QA_CANARY_CLEANUP_ARTIFACT_REQUIRED");
  let next = await transition(store, journal, "CLEANUP_COMMENT", { cleanup: { ...journal.cleanup, comment: "SUBMISSION_PENDING" } });
  await adapter.deleteComment(comment);
  if (!(await adapter.verifyCommentAbsent(comment))) throw new Error("QA_CANARY_COMMENT_RESIDUE");
  next = await transition(store, next, "CLEANUP_POST", { cleanup: { ...next.cleanup, comment: "COMPLETE", post: "SUBMISSION_PENDING" } });
  await adapter.deletePost(post);
  if (!(await adapter.verifyPostAbsent(post))) throw new Error("QA_CANARY_POST_RESIDUE");
  const residue = await adapter.verifyResidue({ markers: next.markers, prepared: next.prepared });
  if (!residue?.ok) throw new Error("QA_CANARY_RESIDUE_CHECK_FAILED");
  return transition(store, next, "COMPLETE", { cleanup: { ...next.cleanup, post: "COMPLETE", residue: "COMPLETE" } });
}

export async function recoverMinimalCanary({ recoveryAdapter, store, journal, recoveryConfirmationHash }) {
  validateJournal(journal); if (typeof recoveryAdapter?.createPost === "function" || typeof recoveryAdapter?.createComment === "function") throw new Error("QA_CANARY_RECOVERY_CAPABILITY_UNSAFE");
  if (!/^[a-f0-9]{64}$/i.test(String(recoveryConfirmationHash ?? ""))) throw new Error("QA_CANARY_RECOVERY_CONFIRMATION_INVALID");
  let next = await transition(store, journal, "RECOVERY_ONLY", { prepared: { ...journal.prepared, creationEnabled: false, recoveryOnly: true } });
  const result = await recoveryAdapter.enumeratePosts({ journal: next }); if (!result?.complete || !["ZERO_POST_CANDIDATES", "EXACTLY_ONE_POST_CANDIDATE", "MULTIPLE_POST_CANDIDATES", "POST_QUERY_AMBIGUOUS"].includes(result.classification)) throw new Error("QA_CANARY_RECOVERY_QUERY_INCOMPLETE");
  next = await transition(store, next, result.classification === "EXACTLY_ONE_POST_CANDIDATE" ? "POST_ADOPTED" : "BLOCKED", { recovery: { candidateClassification: result.classification, queryDigest: result.digest ?? null, adopted: false } });
  if (result.classification !== "EXACTLY_ONE_POST_CANDIDATE") return next;
  const candidate = result.candidates?.[0]; assertArtifact("post", candidate, next); if (candidate.circleId !== next.prepared.circleId || candidate.circleSlug !== next.prepared.circleSlug) throw new Error("QA_CANARY_RECOVERY_SCOPE_MISMATCH");
  next = await transition(store, next, "POST_ADOPTED", { artifacts: { ...next.artifacts, post: candidate }, recovery: { ...next.recovery, adopted: true } });
  const reread = await store.read(); if (!reread.recovery.adopted || reread.artifacts.post?.id !== candidate.id) throw new Error("QA_CANARY_RECOVERY_ADOPTION_REREAD_MISMATCH"); return reread;
}
