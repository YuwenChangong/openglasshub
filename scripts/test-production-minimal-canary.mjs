import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { COMMENT_TEMPLATE_VERSION, CANARY_APPROVAL, CANONICAL_ENCODING_VERSION, PAGINATION_CONTRACT_VERSION, POST_TEMPLATE_VERSION, RECOVERY_QUERY_CONTRACT_VERSION, createJournal, createMarkers, contentFor, executeMinimalCanary, generateCanaryRunId, recoverMinimalCanary } from "./qa/production-minimal-canary-core.mjs";
import { createFileJournalStore, findUnfinishedJournals } from "./qa/production-minimal-canary-journal.mjs";

const actorId = "11111111-1111-4111-8111-111111111111";
const circleId = "22222222-2222-4222-8222-222222222222";
class MemoryStore {
  constructor({ failAfterWrites = null, rereadMismatch = false } = {}) { this.value = null; this.writes = []; this.failAfterWrites = failAfterWrites; this.rereadMismatch = rereadMismatch; }
  async write(value) { if (this.failAfterWrites !== null && this.writes.length >= this.failAfterWrites) throw new Error("STORE_WRITE_FAILED"); this.value = structuredClone(value); this.writes.push(this.value); }
  async read() { const value = structuredClone(this.value); if (this.rereadMismatch && value) value.state = "BLOCKED"; return value; }
  async exists() { return this.value !== null; }
}
class Adapter {
  constructor({ ambiguousPost = false } = {}) { this.calls = []; this.ambiguousPost = ambiguousPost; this.post = null; this.comment = null; }
  async createPost({ marker }) { this.calls.push("createPost"); this.post = { id: "33333333-3333-4333-8333-333333333333", ownerId: actorId, circleId, circleSlug: "qa-circle", marker }; if (this.ambiguousPost) { const error = new Error("network timeout"); error.ambiguous = true; throw error; } return this.post; }
  async createComment({ marker, postId }) { this.calls.push("createComment"); this.comment = { id: "44444444-4444-4444-8444-444444444444", ownerId: actorId, postId, circleId, circleSlug: "qa-circle", marker }; return this.comment; }
  async deleteComment() { this.calls.push("deleteComment"); this.comment = null; }
  async deletePost() { this.calls.push("deletePost"); this.post = null; }
  async verifyCommentAbsent() { return this.comment === null; }
  async verifyPostAbsent() { return this.post === null; }
  async verifyResidue() { return { ok: this.post === null && this.comment === null }; }
}
function prepared(markers, patch = {}) { const content = contentFor(markers); return { actorId, circleId, circleSlug: "qa-circle", resolvedCircleSlug: "qa-circle", runnerCommit: "a".repeat(40), attestationSha256: "b".repeat(64), deploymentId: "deployment", deployedCommit: "c".repeat(40), baseUrl: "https://openglasshub.pages.dev", supabaseRefDigest: "d".repeat(64), postMarker: markers.post, commentMarker: markers.comment, postTitleSha256: hash(content.title), postBodySha256: hash(content.body), commentBodySha256: hash(content.comment), encodingVersion: CANONICAL_ENCODING_VERSION, postTemplateVersion: POST_TEMPLATE_VERSION, commentTemplateVersion: COMMENT_TEMPLATE_VERSION, recoveryQueryContractVersion: RECOVERY_QUERY_CONTRACT_VERSION, paginationContractVersion: PAGINATION_CONTRACT_VERSION, requestTimeoutMs: 30000, creationEnabled: true, recoveryOnly: false, plannedPostCount: 1, plannedCommentCount: 1, cleanupOrder: "comment-then-post", networkRetryPolicy: "zero", ...patch }; }
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function journal(runId = generateCanaryRunId()) { const markers = createMarkers(runId); return createJournal({ runId, markers, prepared: prepared(markers) }); }

{ const value = journal(); const store = new MemoryStore(); await store.write(value); const adapter = new Adapter(); const complete = await executeMinimalCanary({ adapter, store, journal: value }); assert.equal(complete.state, "COMPLETE"); assert.deepEqual(adapter.calls, ["createPost", "createComment", "deleteComment", "deletePost"]); assert.equal(store.writes[1].state, "POST_SUBMISSION_PENDING"); }
{ const value = journal(); const store = new MemoryStore({ failAfterWrites: 1 }); await store.write(value); const adapter = new Adapter(); await assert.rejects(executeMinimalCanary({ adapter, store, journal: value }), /STORE_WRITE_FAILED/); assert.deepEqual(adapter.calls, []); }
{ const value = journal(); const store = new MemoryStore({ rereadMismatch: true }); await store.write(value); const adapter = new Adapter(); await assert.rejects(executeMinimalCanary({ adapter, store, journal: value }), /CREATION_NOT_PREPARED/); assert.deepEqual(adapter.calls, []); }
{ const value = journal(); const store = new MemoryStore(); await store.write(value); const adapter = new Adapter({ ambiguousPost: true }); await assert.rejects(executeMinimalCanary({ adapter, store, journal: value }), /network timeout/); assert.deepEqual(adapter.calls, ["createPost"]); assert.equal((await store.read()).state, "POST_SUBMISSION_AMBIGUOUS"); }
{ const runId = generateCanaryRunId(); const value = journal(runId); const store = new MemoryStore(); await store.write(value); await assert.rejects(recoverMinimalCanary({ store, journal: value, recoveryAdapter: { createPost() {}, enumeratePosts() {} }, recoveryConfirmationHash: "a".repeat(64) }), /RECOVERY_CAPABILITY_UNSAFE/); }
for (const classification of ["ZERO_POST_CANDIDATES", "MULTIPLE_POST_CANDIDATES", "POST_QUERY_AMBIGUOUS"]) {
  const value = journal(); const store = new MemoryStore(); await store.write(value);
  const result = await recoverMinimalCanary({ store, journal: value, recoveryConfirmationHash: "a".repeat(64), recoveryAdapter: { async enumeratePosts() { return { complete: true, classification, candidates: [], digest: "e".repeat(64) }; } } });
  assert.equal(result.state, "BLOCKED"); assert.equal(result.recovery.adopted, false);
}
{ const value = journal(); const store = new MemoryStore(); await store.write(value); const candidate = { id: "55555555-5555-4555-8555-555555555555", ownerId: actorId, circleId, circleSlug: "qa-circle", marker: value.markers.post }; const result = await recoverMinimalCanary({ store, journal: value, recoveryConfirmationHash: "a".repeat(64), recoveryAdapter: { async enumeratePosts() { return { complete: true, classification: "EXACTLY_ONE_POST_CANDIDATE", candidates: [candidate], digest: "f".repeat(64) }; } } }); assert.equal(result.state, "POST_ADOPTED"); assert.equal(result.artifacts.post.id, candidate.id); }
{ const temp = await mkdtemp(path.join(os.tmpdir(), "qa-canary-v2-")); const value = journal(); const store = createFileJournalStore(temp, value.runId); await store.write(value); assert.equal((await findUnfinishedJournals(temp, actorId)).length, 1); await writeFile(store.path, "{}", "utf8"); await assert.rejects(store.read(), /INTEGRITY_INVALID/); await rm(temp, { recursive: true, force: true }); }
assert.equal(CANARY_APPROVAL, "APPROVE_R6_HARDENED_WRITE_AHEAD_FRESH_ATTESTATION_AUTH_DRY_RUN_AND_CANARY_EXECUTION");
console.log("PRODUCTION_MINIMAL_CANARY_V2_OK write-ahead, ambiguity, exact-recovery, and cleanup tests passed with zero network");
