import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createModerationNotificationWriter } from "../src/lib/server/moderation-notifications.server.ts";

const root = process.cwd();
const actorId = "00000000-0000-4000-8000-000000000001";
const recipientId = "00000000-0000-4000-8000-000000000002";
const postId = "00000000-0000-4000-8000-000000000003";
const commentId = "00000000-0000-4000-8000-000000000004";
const calls = [];
let clients = 0;

const writer = createModerationNotificationWriter(
  { SUPABASE_URL: "offline", SUPABASE_SERVICE_ROLE_KEY: "offline" },
  actorId,
  {
    createServiceClient: () => {
      clients += 1;
      return {
        rpc: async (name, args) => {
          calls.push({ name, args });
          return { error: null };
        },
      };
    },
  },
);

assert.equal(clients, 0, "writer construction is not privileged client construction");
assert.equal(await writer.send({ type: "user_warned", recipientId: "not-a-uuid" }), false);
assert.equal(clients, 0, "invalid recipient reaches no privileged client");
assert.equal(await writer.send({ type: "post_moderated", recipientId, postId: "not-a-uuid" }), false);
assert.equal(clients, 0, "invalid target reaches no privileged client");
assert.equal(await writer.send({ type: "user_warned", recipientId: actorId }), false);
assert.equal(clients, 0, "self notification reaches no privileged client");
assert.equal(await writer.send({ type: "unsupported", recipientId }), false);
assert.equal(clients, 0, "unsupported command reaches no privileged client");

assert.equal(await writer.send({ type: "comment_moderated", recipientId, postId, commentId }), true);
assert.equal(clients, 1);
assert.deepEqual(calls, [{
  name: "insert_forum_notification",
  args: {
    p_recipient_id: recipientId,
    p_actor_id: actorId,
    p_type: "comment_moderated",
    p_post_id: postId,
    p_comment_id: commentId,
    p_circle_id: null,
  },
}]);

const failingWriter = createModerationNotificationWriter(
  { SUPABASE_URL: "offline", SUPABASE_SERVICE_ROLE_KEY: "offline" },
  actorId,
  { createServiceClient: () => ({ rpc: async () => ({ error: { message: "private" } }) }) },
);
assert.equal(await failingWriter.send({ type: "user_restricted", recipientId }), false, "repository failure is sanitized to false");

for (const relativePath of [
  "src/pages/api/admin/users/[id]/ban.ts",
  "src/pages/api/admin/users/[id]/clear-warning.ts",
  "src/pages/api/admin/users/[id]/suspend.ts",
  "src/pages/api/admin/users/[id]/unban.ts",
  "src/pages/api/admin/users/[id]/warn.ts",
  "src/pages/api/admin/reports/[id]/action.ts",
]) {
  const source = await readFile(path.join(root, relativePath), "utf8");
  const auth = source.indexOf("requireModerator(request, env)");
  const consent = source.indexOf("const consent = await requireAuthenticatedLegalConsent");
  const writerIndex = source.indexOf("createModerationNotificationWriter(env, auth.user.id)");
  assert.ok(auth >= 0 && consent > auth && writerIndex > consent, `${relativePath} creates the writer only after staff auth and consent`);
  assert.ok(source.includes("notificationWriter,"), `${relativePath} passes the actor-bound writer to the authorized helper`);
}

const writerSource = await readFile(path.join(root, "src/lib/server/moderation-notifications.server.ts"), "utf8");
assert.match(writerSource, /client\.rpc\("insert_forum_notification"/);
assert.equal((writerSource.match(/\.rpc\(/g) ?? []).length, 1, "writer exposes one fixed RPC only");
assert.doesNotMatch(writerSource, /client\.(?:from|storage|functions)\(/, "writer exposes no table, storage, or function executor");
assert.doesNotMatch(writerSource, /params\.client\.rpc/, "authenticated RLS clients cannot invoke the notification RPC");

console.log("MODERATION_NOTIFICATION_WRITER_OK offline cases=15 service-role-rpc=1");
