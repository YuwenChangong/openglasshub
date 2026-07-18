import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createJournal, createMarkers, executeMinimalCanary, generateCanaryRunId, recoverMinimalCanary, validateCanaryRunId } from "./qa/production-minimal-canary-core.mjs";
import { createFileJournalStore, findUnfinishedJournals } from "./qa/production-minimal-canary-journal.mjs";

class MemoryStore { constructor() { this.value = null; this.writes = []; } async write(v) { this.value = structuredClone(v); this.writes.push(this.value); } async read() { return structuredClone(this.value); } }
class FakeAdapter {
  constructor({ crashAt = null, ambiguousPost = false, ambiguousComment = false, residue = false } = {}) { this.crashAt = crashAt; this.ambiguousPost = ambiguousPost; this.ambiguousComment = ambiguousComment; this.residue = residue; this.owner = "11111111-1111-4111-8111-111111111111"; this.posts = new Map(); this.comments = new Map(); this.calls = []; }
  crash(stage) { if (this.crashAt === stage) { const e = new Error(`CRASH:${stage}`); e.crash = true; throw e; } }
  async authenticate() { this.calls.push("auth"); return { id: this.owner }; }
  async createPost({ marker }) { this.calls.push("createPost"); const value = { id: "22222222-2222-4222-8222-222222222222", ownerId: this.owner, marker }; this.posts.set(value.id, value); this.crash("post-response"); if (this.ambiguousPost) { const e = new Error("timeout"); e.ambiguous = true; throw e; } return value; }
  async createComment({ marker, postId }) { this.calls.push("createComment"); const value = { id: "33333333-3333-4333-8333-333333333333", ownerId: this.owner, postId, marker }; this.comments.set(value.id, value); this.crash("comment-response"); if (this.ambiguousComment) { const e = new Error("timeout"); e.ambiguous = true; throw e; } return value; }
  async verifyPost(value) { return this.posts.has(value.id); } async verifyComment(value) { return this.comments.has(value.id); }
  async findPostByMarker({ marker }) { return [...this.posts.values()].filter((x) => x.marker === marker); } async findCommentByMarker({ marker, postId }) { return [...this.comments.values()].filter((x) => x.marker === marker && x.postId === postId); }
  async deleteComment(value) { this.calls.push("deleteComment"); this.crash("comment-cleanup"); this.comments.delete(value.id); } async deletePost(value) { this.calls.push("deletePost"); this.crash("post-cleanup"); this.posts.delete(value.id); }
  async verifyCommentAbsent(value) { return !this.comments.has(value.id); } async verifyPostAbsent(value) { return !this.posts.has(value.id); } async verifyResidue() { return { ok: !this.residue && this.posts.size === 0 && this.comments.size === 0 }; }
}
function journal(runId) { return createJournal({ runId, target: { baseUrl: "https://openglasshub.pages.dev", supabaseRef: "abcdef" }, qaUserId: "11111111-1111-4111-8111-111111111111", expectedCommit: "a".repeat(40), markers: createMarkers(runId) }); }
async function run(options = {}) { const store = new MemoryStore(); const adapter = new FakeAdapter(options); const value = journal(generateCanaryRunId()); return { store, adapter, value }; }
{ const { store, adapter, value } = await run(); const complete = await executeMinimalCanary({ store, adapter, journal: value }); assert.equal(complete.state, "COMPLETE"); assert.deepEqual(adapter.calls.slice(-2), ["deleteComment", "deletePost"]); assert.equal(store.writes[0].state, "PLANNED"); }
for (const crashAt of ["post-response", "comment-response", "comment-cleanup", "post-cleanup"]) { const { store, adapter, value } = await run({ crashAt }); await assert.rejects(executeMinimalCanary({ store, adapter, journal: value })); adapter.crashAt = null; const recovered = await recoverMinimalCanary({ store, adapter, journal: await store.read(), recoveryConfirmationHash: "a".repeat(64) }); assert.equal(recovered.journal.state, "COMPLETE", `recovery ${crashAt}`); assert.equal((await recoverMinimalCanary({ store, adapter, journal: recovered.journal, recoveryConfirmationHash: "b".repeat(64) })).alreadyClean, true); }
for (const options of [{ ambiguousPost: true }, { ambiguousComment: true }]) { const { store, adapter, value } = await run(options); const complete = await executeMinimalCanary({ store, adapter, journal: value }); assert.equal(complete.state, "COMPLETE"); assert.equal(adapter.calls.filter((x) => x === "createPost").length, 1); assert.equal(adapter.calls.filter((x) => x === "createComment").length, 1); }
{ const { store, adapter, value } = await run({ residue: true }); await assert.rejects(executeMinimalCanary({ store, adapter, journal: value }), /RESIDUE/); }
assert.throws(() => validateCanaryRunId("yes"), /RUN_ID_INVALID/);
{ const { store, adapter, value } = await run(); value.scope.push("media"); await assert.rejects(executeMinimalCanary({ store, adapter, journal: value }), /SCOPE_INVALID/); }
{ const temp = await mkdtemp(path.join(os.tmpdir(), "qa-canary-journal-")); const runId = generateCanaryRunId(); const store = createFileJournalStore(temp, runId); const value = journal(runId); await store.write(value); assert.equal((await store.read()).runId, runId); assert.equal((await findUnfinishedJournals(temp, value.qaUserId)).length, 1); await writeFile(store.path, "{}", "utf8"); await assert.rejects(store.read(), /INTEGRITY_INVALID/); await rm(temp, { recursive: true, force: true }); }
console.log("PRODUCTION_MINIMAL_CANARY_OK crash/recovery matrix passed with zero network writes");
