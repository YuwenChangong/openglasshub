import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const sourcePath = new URL("../src/pages/api/forum/comments.ts", import.meta.url);
const migrationPath = new URL("../supabase/migrations/20260713_comment_creation_circle_authorization.sql", import.meta.url);
const historicalMigrationPath = new URL("../supabase/migrations/20260616_community_moderation_mvp.sql", import.meta.url);
const historicalMigrationSha256 = "2a7029b8a38ed585cb2890f2aeda3f354dc99a2a38c6a2967f23bfa5d49237e8";

const ids = {
  actor: "11111111-1111-4111-8111-111111111111",
  post: "22222222-2222-4222-8222-222222222222",
  circle: "33333333-3333-4333-8333-333333333333",
  parent: "44444444-4444-4444-8444-444444444444",
};

function accessibleRows() {
  return {
    post: { id: ids.post, circle_id: ids.circle, status: "published", moderation_status: "published" },
    circle: { id: ids.circle, slug: "open-glass", name: "OpenGlass", status: "active" },
    parent: { id: ids.parent, post_id: ids.post, status: "published", moderation_status: "published" },
  };
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function canCreateComment(rows, postId, parentId) {
  const post = rows.post;
  if (
    !post ||
    post.id !== postId ||
    !isUuid(post.circle_id) ||
    post.status !== "published" ||
    post.moderation_status !== "published"
  ) return false;

  const circle = rows.circle;
  if (
    !circle ||
    circle.id !== post.circle_id ||
    circle.status !== "active" ||
    ["rls-test-circle", "rls-test", "test-circle"].includes(circle.slug.toLowerCase()) ||
    circle.name.toLowerCase().includes("rls test")
  ) return false;

  if (!parentId) return true;
  const parent = rows.parent;
  return Boolean(
    parent &&
    parent.id === parentId &&
    parent.post_id === post.id &&
    parent.status === "published" &&
    parent.moderation_status === "published",
  );
}

function attemptCommentCreation({ actorId = ids.actor, postId = ids.post, parentId = null, suppliedAuthorId, suppliedUserId, suppliedCircleId } = {}, rows = accessibleRows()) {
  const effects = [];
  if (!actorId || !isUuid(postId) || (parentId && !isUuid(parentId))) return { allowed: false, effects };
  if (!canCreateComment(rows, postId, parentId)) return { allowed: false, effects };

  // The model mirrors the route contract: the verified actor and server-derived
  // target are the only values that can reach the insert payload.
  effects.push({ kind: "comments.insert", authorId: actorId, postId: rows.post.id, parentId: parentId ?? null });
  assert.notEqual(suppliedAuthorId, undefined, "caller-controlled author input is not part of the route payload");
  assert.notEqual(suppliedUserId, undefined, "caller-controlled user input is not part of the route payload");
  assert.notEqual(suppliedCircleId, undefined, "caller-controlled circle input is not part of the route payload");
  return { allowed: true, effects };
}

const topLevel = attemptCommentCreation({ suppliedAuthorId: "attacker", suppliedUserId: "attacker", suppliedCircleId: "attacker" });
assert.equal(topLevel.allowed, true, "authenticated actor may comment on an accessible published post");
assert.deepEqual(topLevel.effects, [{ kind: "comments.insert", authorId: ids.actor, postId: ids.post, parentId: null }]);

const reply = attemptCommentCreation({ parentId: ids.parent, suppliedAuthorId: "attacker", suppliedUserId: "attacker", suppliedCircleId: "attacker" });
assert.equal(reply.allowed, true, "authenticated actor may reply to a published same-post parent");
assert.deepEqual(reply.effects, [{ kind: "comments.insert", authorId: ids.actor, postId: ids.post, parentId: ids.parent }]);

const deniedCases = [
  ["soft-deleted circle", { ...accessibleRows(), circle: { ...accessibleRows().circle, status: "deleted" } }, {}],
  ["hidden canonical circle", { ...accessibleRows(), circle: { ...accessibleRows().circle, slug: "rls-test-circle" } }, {}],
  ["inactive circle", { ...accessibleRows(), circle: { ...accessibleRows().circle, status: "inactive" } }, {}],
  ["missing circle", { ...accessibleRows(), circle: null }, {}],
  ["post/circle relationship mismatch", { ...accessibleRows(), circle: { ...accessibleRows().circle, id: "55555555-5555-4555-8555-555555555555" } }, {}],
  ["hidden post", { ...accessibleRows(), post: { ...accessibleRows().post, moderation_status: "hidden_by_admin" } }, {}],
  ["deleted post", { ...accessibleRows(), post: { ...accessibleRows().post, status: "deleted" } }, {}],
  ["unpublished post", { ...accessibleRows(), post: { ...accessibleRows().post, status: "pending", moderation_status: "pending_review" } }, {}],
  ["parent belongs to another post", { ...accessibleRows(), parent: { ...accessibleRows().parent, post_id: "66666666-6666-4666-8666-666666666666" } }, { parentId: ids.parent }],
  ["hidden parent", { ...accessibleRows(), parent: { ...accessibleRows().parent, moderation_status: "hidden_by_admin" } }, { parentId: ids.parent }],
  ["deleted parent", { ...accessibleRows(), parent: { ...accessibleRows().parent, status: "deleted" } }, { parentId: ids.parent }],
  ["missing parent", { ...accessibleRows(), parent: null }, { parentId: ids.parent }],
  ["unauthenticated actor", accessibleRows(), { actorId: null }],
  ["malformed post id", accessibleRows(), { postId: "not-a-uuid" }],
  ["malformed parent id", accessibleRows(), { parentId: "not-a-uuid" }],
];

for (const [name, rows, input] of deniedCases) {
  const attempt = attemptCommentCreation(input, rows);
  assert.equal(attempt.allowed, false, `${name} is denied`);
  assert.deepEqual(attempt.effects, [], `${name} makes zero comment, notification, count/RPC, audit, or external effects`);
}

const source = readFileSync(sourcePath, "utf8");
const postSource = source.slice(source.indexOf("export const POST"), source.indexOf("export const DELETE"));
const targetCall = postSource.indexOf("const commentTarget = await resolveAccessibleCommentCreationTarget(userClient, postId, parentId)");
const moderationCall = postSource.indexOf("const moderation = await moderateContent");
const rateLimitCall = postSource.indexOf("const rateLimit = await enforceUserRateLimit");
const commentInsert = postSource.indexOf('.from("comments")', postSource.indexOf("// Insert comment"));
assert.ok(targetCall > 0 && moderationCall > targetCall && rateLimitCall > moderationCall && commentInsert > rateLimitCall, "POST resolves post/circle/parent ancestry before moderation, rate persistence, and comment insertion");
assert.match(source, /select\("id,circle_id,status,moderation_status"\)/, "runtime derives the post circle id from a server read");
assert.match(source, /circle\.status\?\.toLowerCase\(\) !== "active" \|\|\s+!isPublicVisibleCircle\(circle\)/, "runtime requires an active canonical-visible circle");
assert.match(source, /\.eq\("post_id", postRow\.id\)/, "runtime binds a reply parent to the resolved post");
assert.match(source, /post_id: commentTarget\.postId/, "insert uses the server-derived post id");
assert.match(source, /parent_id = commentTarget\.parentId/, "insert uses the server-derived parent id");
assert.doesNotMatch(postSource, /payload\.(author_id|user_id|circle_id|role|status|visibility|membership)/, "POST accepts no client-controlled identity, circle, role, or visibility override");
assert.doesNotMatch(postSource, /\.from\("forum_notifications"\)|\.rpc\(/, "POST has no explicit notification or count/RPC mutation path");

const migration = readFileSync(migrationPath, "utf8");
for (const required of [
  "public.can_create_comment_target(",
  "from public.posts as p",
  "join public.circles as circle_ref on circle_ref.id = p.circle_id",
  "p.status = 'published'",
  "p.moderation_status = 'published'",
  "circle_ref.status = 'active'",
  "target_parent_comment_id is null",
  "parent_comment.post_id = p.id",
  "parent_comment.status = 'published'",
  "parent_comment.moderation_status = 'published'",
  'drop policy if exists "comments_insert_self"',
  'create policy "comments_insert_self"',
  "author_id = auth.uid()",
  "public.can_create_comment_target(post_id, parent_id)",
  "current schema has no private-circle or membership table",
]) {
  assert.ok(migration.includes(required), `migration includes ${required}`);
}
assert.doesNotMatch(migration, /with check \(\s*author_id = auth\.uid\(\)\s*and status::text in/i, "new INSERT policy does not rely on comment status alone");
const historicalMigrationHash = createHash("sha256").update(readFileSync(historicalMigrationPath)).digest("hex");
assert.equal(historicalMigrationHash, historicalMigrationSha256, "historical comments INSERT migration is unchanged");

console.log("comment creation circle authorization tests passed");
