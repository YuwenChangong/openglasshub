import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getMinimalCanaryMutationPlan } from "./qa/r6-final-canary-execution-contract.mjs";

const [forumSchema, notifications] = await Promise.all([
  readFile("supabase/migrations/20260518_forum_phase1_schema.sql", "utf8"),
  readFile("supabase/migrations/20260606_forum_notifications_mvp.sql", "utf8"),
]);
const plan = getMinimalCanaryMutationPlan();
assert.deepEqual(plan.indirectDatabaseEffects, [
  { trigger: "trg_comments_bump_post_last_activity", operation: "UPDATE_POST_LAST_ACTIVITY", expectedFor: "CREATE_COMMENT", scope: "created-canary-post" },
  { trigger: "trg_comments_notify_created", operation: "NO_NOTIFICATION_FOR_SELF_COMMENT", expectedFor: "CREATE_COMMENT", scope: "same-qa-author" },
]);
assert.match(forumSchema, /create trigger trg_comments_bump_post_last_activity[\s\S]*?after insert or update on public\.comments/i);
assert.match(forumSchema, /update public\.posts\s+set last_activity_at = now\(\)/i);
assert.match(notifications, /if p_actor_id is not null and p_actor_id = p_recipient_id then\s+return;/i);
assert.match(notifications, /create trigger trg_comments_notify_created[\s\S]*?after insert on public\.comments/i);
process.stdout.write("PRODUCTION_MINIMAL_CANARY_INDIRECT_WRITE_AUDIT_OK expected post activity update and self-notification suppression are bound to plan v2\n");
