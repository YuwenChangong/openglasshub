import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  applyUserSafetyAction,
  authorizeUserSafetyAction,
} from "../src/lib/server/user-safety.server.ts";

function createFakeClient(roles, initialState = null) {
  const writes = { states: [], events: [], notifications: [] };
  let state = initialState;

  return {
    writes,
    from(table) {
      if (table === "profiles") {
        return {
          select() {
            return {
              eq(_column, id) {
                return {
                  async maybeSingle() {
                    const role = roles[id];
                    return { data: role === undefined ? null : { id, role }, error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "user_safety_states") {
        return {
          select() {
            return {
              eq() {
                return { maybeSingle: async () => ({ data: state, error: null }) };
              },
            };
          },
          async insert(payload) {
            writes.states.push(payload);
            state = payload;
            return { error: null };
          },
          update(payload) {
            return {
              eq() {
                writes.states.push(payload);
                state = { ...state, ...payload };
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }

      if (table === "user_safety_events") {
        return {
          async insert(payload) {
            writes.events.push(payload);
            return { error: null };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
    async rpc(name, payload) {
      writes.notifications.push({ name, payload });
      return { error: null };
    },
  };
}

async function assertDenied({ actorId = "actor", targetId = "target", actorRole, targetRole, suppliedActorRole }) {
  const client = createFakeClient({ [actorId]: actorRole, [targetId]: targetRole });
  const result = await applyUserSafetyAction({
    client,
    actorId,
    targetUserId: targetId,
    action: "ban",
    reason: "offline privilege-boundary test",
    actorRole: suppliedActorRole,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.deepEqual(client.writes, { states: [], events: [], notifications: [] });
}

async function assertAllowed(actorRole, targetRole) {
  const client = createFakeClient({ actor: actorRole, target: targetRole });
  const result = await applyUserSafetyAction({
    client,
    actorId: "actor",
    targetUserId: "target",
    action: "ban",
    reason: "offline privilege-boundary test",
  });
  assert.equal(result.ok, true);
  assert.equal(client.writes.states.length, 1);
  assert.equal(client.writes.states[0].updated_by, "actor");
  assert.equal(client.writes.events.length, 1);
  assert.equal(client.writes.events[0].actor_id, "actor");
  assert.equal(client.writes.notifications.length, 1);
}

async function assertClearWarningBehavior() {
  const activeState = { user_id: "target", reputation_score: 0, strike_count: 0, warning_count: 0, status: "active", suspended_until: null, banned_at: null, ban_reason: null, last_action_at: null, updated_by: null };
  const noOpClient = createFakeClient({ actor: "admin", target: "user" }, activeState);
  const noOp = await applyUserSafetyAction({ client: noOpClient, actorId: "actor", targetUserId: "target", action: "clear_warning", reason: null });
  assert.equal(noOp.ok, true);
  assert.deepEqual(noOpClient.writes, { states: [], events: [], notifications: [] });

  const warnedState = { ...activeState, warning_count: 1, status: "warned", reputation_score: -1 };
  const clearClient = createFakeClient({ actor: "moderator", target: "user" }, warnedState);
  const cleared = await applyUserSafetyAction({ client: clearClient, actorId: "actor", targetUserId: "target", action: "clear_warning", reason: "reviewed" });
  assert.equal(cleared.ok, true);
  assert.equal(clearClient.writes.states.length, 1);
  assert.equal(clearClient.writes.events.length, 1);
  assert.equal(clearClient.writes.events[0].event_type, "note");
  assert.equal(clearClient.writes.events[0].actor_id, "actor");
  assert.equal(clearClient.writes.notifications.length, 0);
}

assert.equal(authorizeUserSafetyAction({ actorId: "actor", targetUserId: "target", actorRole: "moderator", targetRole: "user" }).ok, true);
assert.equal(authorizeUserSafetyAction({ actorId: "actor", targetUserId: "target", actorRole: "admin", targetRole: "moderator" }).ok, true);

await assertAllowed("moderator", "user");
await assertAllowed("admin", "user");
await assertAllowed("admin", "moderator");
await assertClearWarningBehavior();
await assertDenied({ actorId: "actor", targetId: "actor", actorRole: "moderator", targetRole: "moderator" });
await assertDenied({ actorRole: "moderator", targetRole: "moderator" });
await assertDenied({ actorRole: "moderator", targetRole: "admin" });
await assertDenied({ actorRole: "admin", targetRole: "admin" });
await assertDenied({ actorRole: "moderator", targetRole: null });
await assertDenied({ actorRole: "moderator", targetRole: "owner" });
await assertDenied({ actorRole: null, targetRole: "user" });
await assertDenied({ actorRole: "owner", targetRole: "user" });
await assertDenied({ actorRole: "moderator", targetRole: "admin", suppliedActorRole: "admin" });

const banRoute = await fs.readFile(new URL("../src/pages/api/admin/users/[id]/ban.ts", import.meta.url), "utf8");
const clearWarningRoute = await fs.readFile(new URL("../src/pages/api/admin/users/[id]/clear-warning.ts", import.meta.url), "utf8");
assert.match(banRoute, /targetUserId = String\(params\.id/);
assert.match(banRoute, /actorId: auth\.user\.id/);
assert.doesNotMatch(banRoute, /actorRole|payload\?\.actor|payload\?\.user/i);
assert.match(clearWarningRoute, /targetUserId = String\(params\.id/);
assert.match(clearWarningRoute, /actorId: auth\.user\.id/);
assert.doesNotMatch(clearWarningRoute, /actorRole|payload\?\.actor|payload\?\.user/i);

console.log("USER SAFETY PRIVILEGE BOUNDARY TEST PASSED");
