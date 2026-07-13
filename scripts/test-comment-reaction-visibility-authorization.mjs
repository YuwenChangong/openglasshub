import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const sourcePath = new URL("../src/pages/api/forum/comments.ts", import.meta.url);
const migrationPath = new URL("../supabase/migrations/20260713_comment_reaction_visibility_authorization.sql", import.meta.url);
const historicalMigrationPath = new URL("../supabase/migrations/20260603_forum_comments_interactions.sql", import.meta.url);
const historicalMigrationSha256 = "e7b7187ccB3f0f660d3f5e367bb1e791d14335e1365e7aded8fbe4c64fbc6300".toLowerCase();

const ids = {
  comment: "11111111-1111-4111-8111-111111111111",
  post: "22222222-2222-4222-8222-222222222222",
  circle: "33333333-3333-4333-8333-333333333333",
};

function accessibleRows() {
  return {
    comments: { id: ids.comment, post_id: ids.post, status: "published", moderation_status: "published" },
    posts: { id: ids.post, circle_id: ids.circle, status: "published", moderation_status: "published" },
    circles: { id: ids.circle, slug: "open-glass", name: "OpenGlass", status: "active" },
  };
}

function createReadOnlyTargetClient(rows) {
  const tableCalls = [];
  const reactionMutationCalls = [];
  const client = {
    from(table) {
      tableCalls.push(table);
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: rows[table] ?? null, error: null }; },
      };
    },
    reactions: {
      insert() { reactionMutationCalls.push("insert"); },
      update() { reactionMutationCalls.push("update"); },
      delete() { reactionMutationCalls.push("delete"); },
    },
  };
  return { client, tableCalls, reactionMutationCalls };
}

function isAccessibleReactionTarget(rows) {
  const comment = rows.comments;
  if (!comment || comment.status !== "published" || comment.moderation_status !== "published") return false;
  const post = rows.posts;
  if (
    !post ||
    post.id !== comment.post_id ||
    post.status !== "published" ||
    post.moderation_status !== "published"
  ) return false;
  const circle = rows.circles;
  return Boolean(
    circle &&
    circle.id === post.circle_id &&
    circle.status === "active" &&
    !["rls-test-circle", "rls-test", "test-circle"].includes(circle.slug.toLowerCase()) &&
    !circle.name.toLowerCase().includes("rls test"),
  );
}

async function attemptReaction(kind, rows, actorId = "verified-user") {
  const { client, tableCalls, reactionMutationCalls } = createReadOnlyTargetClient(rows);
  // This model covers the source-backed target chain below. It stays fully
  // offline and records that denied inputs cannot reach a mutation call.
  const target = { ok: isAccessibleReactionTarget(rows) };
  if (target.ok) {
    await client.from("comments").select().eq("id", ids.comment).maybeSingle();
    await client.from("posts").select().eq("id", ids.post).maybeSingle();
    await client.from("circles").select().eq("id", ids.circle).maybeSingle();
  }
  if (target.ok && actorId === "verified-user") client.reactions[kind]();
  return { target, tableCalls, mutationCalls: reactionMutationCalls };
}

for (const kind of ["insert", "update", "delete"]) {
  const attempt = await attemptReaction(kind, accessibleRows());
  assert.equal(attempt.target.ok, true, `${kind} is allowed for the verified actor on an accessible target`);
  assert.deepEqual(attempt.mutationCalls, [kind]);
}

const deniedCases = [
  ["unpublished comment", { ...accessibleRows(), comments: { ...accessibleRows().comments, status: "pending" } }],
  ["hidden comment", { ...accessibleRows(), comments: { ...accessibleRows().comments, moderation_status: "hidden" } }],
  ["deleted comment", { ...accessibleRows(), comments: { ...accessibleRows().comments, status: "deleted" } }],
  ["hidden post", { ...accessibleRows(), posts: { ...accessibleRows().posts, moderation_status: "hidden" } }],
  ["deleted post", { ...accessibleRows(), posts: { ...accessibleRows().posts, status: "deleted" } }],
  ["hidden circle", { ...accessibleRows(), circles: { ...accessibleRows().circles, status: "hidden" } }],
  ["deleted circle", { ...accessibleRows(), circles: { ...accessibleRows().circles, status: "deleted" } }],
  ["missing parent post", { ...accessibleRows(), posts: null }],
  ["mismatched parent post", { ...accessibleRows(), posts: { ...accessibleRows().posts, id: "44444444-4444-4444-8444-444444444444" } }],
];

for (const [name, rows] of deniedCases) {
  const attempt = await attemptReaction("insert", rows);
  assert.equal(attempt.target.ok, false, `${name} is denied`);
  assert.deepEqual(attempt.mutationCalls, [], `${name} makes zero reaction mutations`);
  assert.equal(attempt.tableCalls.includes("comment_reactions"), false, `${name} never reaches reaction queries`);
}

const unauthenticated = await attemptReaction("insert", accessibleRows(), null);
assert.equal(unauthenticated.target.ok, true, "target authorization remains separate from bearer verification");
assert.deepEqual(unauthenticated.mutationCalls, [], "an unauthenticated actor makes zero reaction mutations");

const clientSuppliedActor = await attemptReaction("insert", accessibleRows(), "client-supplied-different-user");
assert.deepEqual(clientSuppliedActor.mutationCalls, [], "only the verified actor may reach a mutation");

const source = readFileSync(sourcePath, "utf8");
const targetCall = source.indexOf("const reactionTarget = await resolveAccessibleCommentReactionTarget(userClient, commentId)");
const reactionQuery = source.indexOf('.from("comment_reactions")', targetCall);
assert.ok(targetCall > 0 && reactionQuery > targetCall, "PUT resolves the target chain before any reaction query or mutation");
assert.match(source, /if \(!commentId \|\| !UUID_REGEX\.test\(commentId\)\)/, "malformed comment ids are rejected before target resolution");
assert.match(source, /auth\.getUser\(token\)[\s\S]{0,900}resolveAccessibleCommentReactionTarget/, "bearer verification precedes target resolution");
assert.match(source, /insert\(\{ comment_id: commentId, user_id: authData\.user\.id, reaction_type: "like" \}\)/, "PUT derives the reaction user only from the verified actor");
assert.doesNotMatch(source, /payload\.user_id|payload\.actor_id/, "PUT does not accept a client actor id");
assert.match(source, /comment\.status !== "published" \|\| comment\.moderation_status !== "published"/, "runtime requires a published visible comment");
assert.match(source, /post\.status !== "published" \|\|\s+post\.moderation_status !== "published"/, "runtime requires a published visible parent post");
assert.match(source, /circle\.status\?\.toLowerCase\(\) !== "active" \|\|\s+!isPublicVisibleCircle\(circle\)/, "runtime requires an active visible parent circle");

const migration = readFileSync(migrationPath, "utf8");
for (const required of [
  "public.can_access_comment_reaction_target(comment_id)",
  "from public.comments as c",
  "join public.posts as p on p.id = c.post_id",
  "join public.circles as circle_ref on circle_ref.id = p.circle_id",
  "c.status = 'published'",
  "c.moderation_status = 'published'",
  "p.status = 'published'",
  "p.moderation_status = 'published'",
  "circle_ref.status = 'active'",
  'create policy "comment_reactions_insert_self"',
  'create policy "comment_reactions_update_self"',
  'create policy "comment_reactions_delete_self"',
]) {
  assert.ok(migration.includes(required), `migration includes ${required}`);
}
assert.ok((migration.match(/public\.can_access_comment_reaction_target\(comment_id\)/g) ?? []).length >= 5, "SELECT, INSERT, UPDATE, and DELETE policies all use the full target predicate");
assert.doesNotMatch(migration, /for (?:insert|update|delete)[\s\S]{0,180}comments\.status = 'published'/i, "no mutation policy relies directly on comment publication alone");
const historicalMigrationHash = createHash("sha256").update(readFileSync(historicalMigrationPath)).digest("hex");
assert.equal(historicalMigrationHash, historicalMigrationSha256, "historical reaction migration is unchanged");

console.log("comment reaction visibility authorization tests passed");
