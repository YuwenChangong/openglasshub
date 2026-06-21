import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";

const REQUIRED_ENV = [
  "QA_SUPABASE_URL",
  "QA_SUPABASE_SERVICE_ROLE_KEY",
  "QA_ORDINARY_EMAIL",
  "QA_ADMIN_EMAIL",
];

function requireEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`missing required env: ${missing.join(", ")}`);
    process.exitCode = 1;
    return null;
  }
  return Object.fromEntries(REQUIRED_ENV.map((key) => [key, process.env[key]]));
}

function redactEmail(email) {
  const [local, domain] = String(email).split("@");
  if (!local || !domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim()))).map((value) =>
    value.trim(),
  );
}

function loadDotEnv() {
  if (!existsSync(".env")) return {};
  const raw = readFileSync(".env", "utf8");
  const values = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match) continue;
    let value = match[2] ?? "";
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function resolveUserCleanupConfig(env) {
  const dotEnv = loadDotEnv();
  const anonKey =
    process.env.PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    dotEnv.PUBLIC_SUPABASE_ANON_KEY ??
    dotEnv.SUPABASE_ANON_KEY ??
    null;

  return {
    url: process.env.PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? dotEnv.PUBLIC_SUPABASE_URL ?? dotEnv.SUPABASE_URL ??
      env.QA_SUPABASE_URL,
    anonKey,
    ordinaryPassword: process.env.QA_ORDINARY_PASSWORD ?? null,
    adminPassword: process.env.QA_ADMIN_PASSWORD ?? null,
  };
}

async function listUsersByEmail(client, email) {
  const users = [];
  let page = 1;
  while (true) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const batch = data?.users ?? [];
    users.push(...batch.filter((user) => user.email?.toLowerCase() === email.toLowerCase()));
    if (batch.length < 200) break;
    page += 1;
  }
  return users;
}

async function revokeAdminRole(client, userId) {
  const { data, error } = await client.rpc("qa_revoke_admin_role", { target_user_id: userId });
  if (error) {
    const message = String(error.message ?? "").toLowerCase();
    if (message.includes("could not find the function") || message.includes("schema cache")) {
      throw new Error("QA_ADMIN_ROLE_RPC_MISSING");
    }
    if (error.code === "42501" || message.includes("permission denied")) {
      throw new Error("QA_ADMIN_ROLE_RPC_PERMISSION_DENIED");
    }
    throw new Error(`QA_ADMIN_ROLE_RPC_FAILED: ${error.message ?? "unknown error"}`);
  }
  if (data !== "user") {
    throw new Error("QA_ADMIN_ROLE_REVOKE_VERIFY_FAILED");
  }
}

async function softHideContent(client, userId) {
  const postResult = await client.from("posts").update({
    status: "hidden_by_admin",
    moderation_status: "hidden_by_admin",
    moderation_reason: "qa_cleanup",
  }).eq("author_id", userId);

  const commentResult = await client.from("comments").update({
    status: "hidden_by_admin",
    moderation_status: "hidden_by_admin",
    moderation_reason: "qa_cleanup",
  }).eq("author_id", userId);

  const circleResult = await client.from("circles").update({
    status: "deleted",
  }).eq("owner_id", userId);

  return {
    posts: postResult.error ? postResult.error.message : null,
    comments: commentResult.error ? commentResult.error.message : null,
    circles: circleResult.error ? circleResult.error.message : null,
  };
}

async function collectStoragePaths(client, userId) {
  const paths = [];

  const { data: mediaRows } = await client
    .from("post_media")
    .select("storage_path, thumbnail_url")
    .eq("user_id", userId);
  for (const row of mediaRows ?? []) {
    paths.push(row.storage_path ?? "", row.thumbnail_url ?? "");
  }

  const { data: profile } = await client
    .from("profiles")
    .select("avatar_url, banner_url")
    .eq("id", userId)
    .maybeSingle();
  if (profile) {
    paths.push(profile.avatar_url ?? "", profile.banner_url ?? "");
  }

  const { data: circles } = await client
    .from("circles")
    .select("image_path")
    .eq("owner_id", userId);
  for (const circle of circles ?? []) {
    paths.push(circle.image_path ?? "");
  }

  return uniqueStrings(paths).filter((value) =>
    /^(profile-avatars|profile-banners|circle-covers|tmp\/|[0-9a-f-]{36}\/)/i.test(value),
  );
}

async function removeStorageObjects(client, paths) {
  if (!paths.length) return { removed: 0, failed: 0 };
  const { data, error } = await client.storage.from("post-media").remove(paths);
  if (error) {
    return { removed: 0, failed: paths.length, error: error.message };
  }
  const removed = Array.isArray(data) ? data.filter((item) => item?.name).length : 0;
  return { removed, failed: Math.max(0, paths.length - removed) };
}

async function resetProfile(client, userId, email) {
  const payload = {
    display_name: "QA User",
    username: null,
    bio: "",
    avatar_url: null,
    banner_url: null,
  };
  const result = await client.from("profiles").update(payload).eq("id", userId);
  return result.error ? { ok: false, error: result.error.message } : { ok: true };
}

async function tryDeleteAuthUser(client, userId) {
  const { error } = await client.auth.admin.deleteUser(userId);
  if (!error) return { deleted: true };
  return {
    deleted: false,
    error: error.message ?? "Database error deleting user",
  };
}

function randomDisabledPassword() {
  return `disabled-${crypto.randomUUID()}-QA!`;
}

async function disableAuthUser(client, userId) {
  const { error } = await client.auth.admin.updateUserById(userId, {
    password: randomDisabledPassword(),
    user_metadata: {
      qa_disabled: true,
      qa_cleanup_at: new Date().toISOString(),
    },
    ban_duration: "876000h",
  });
  return error ? { ok: false, error: error.message ?? "unknown error" } : { ok: true };
}

async function createOwnedCleanupClient(config, email, password) {
  if (!config.url || !config.anonKey || !password) {
    return null;
  }
  const client = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) {
    return null;
  }
  return client;
}

async function cleanupOwnedContent(client, userId) {
  const { data: comments } = await client.from("comments").select("id").eq("author_id", userId).neq("status", "deleted");
  for (const comment of comments ?? []) {
    await client.from("comments").update({ status: "deleted" }).eq("id", comment.id);
  }

  const { data: posts } = await client.from("posts").select("id").eq("author_id", userId).neq("status", "deleted");
  for (const post of posts ?? []) {
    await client.from("posts").update({ status: "deleted" }).eq("id", post.id);
  }

  const { data: circles } = await client.from("circles").select("id").eq("owner_id", userId).neq("status", "deleted");
  for (const circle of circles ?? []) {
    await client.from("circles").update({ status: "deleted" }).eq("id", circle.id);
  }
}

async function main() {
  const env = requireEnv();
  if (!env) return;

  const client = createClient(env.QA_SUPABASE_URL, env.QA_SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const userCleanupConfig = resolveUserCleanupConfig(env);

  const emails = [env.QA_ORDINARY_EMAIL, env.QA_ADMIN_EMAIL];
  let hadFallback = false;
  for (const email of emails) {
    const users = await listUsersByEmail(client, email);
    for (const user of users) {
      const ownedCleanupClient = await createOwnedCleanupClient(
        userCleanupConfig,
        email,
        email === env.QA_ADMIN_EMAIL ? userCleanupConfig.adminPassword : userCleanupConfig.ordinaryPassword,
      );
      if (ownedCleanupClient) {
        await cleanupOwnedContent(ownedCleanupClient, user.id);
      }

      const storagePaths = await collectStoragePaths(client, user.id);
      const softHideErrors = await softHideContent(client, user.id);
      if (email === env.QA_ADMIN_EMAIL) {
        await revokeAdminRole(client, user.id);
      }
      const storageResult = await removeStorageObjects(client, storagePaths);
      const deleteResult = await tryDeleteAuthUser(client, user.id);
      if (deleteResult.deleted) {
        console.log(`cleaned QA user ${redactEmail(email)} (deleted auth user, removed ${storageResult.removed} objects)`);
        continue;
      }

      hadFallback = true;
      const profileReset = await resetProfile(client, user.id, email);
      const authDisable = await disableAuthUser(client, user.id);
      console.log(
        `cleaned QA user ${redactEmail(email)} (fallback preserved auth user; admin revoked=${email === env.QA_ADMIN_EMAIL ? "yes" : "n/a"}; profile_reset=${profileReset.ok ? "yes" : `no:${profileReset.error}`}; auth_disabled=${authDisable.ok ? "yes" : `no:${authDisable.error}`}; removed ${storageResult.removed} objects; auth_delete_error=${deleteResult.error}; soft_hide_posts=${softHideErrors.posts ?? "ok"}; soft_hide_comments=${softHideErrors.comments ?? "ok"}; soft_hide_circles=${softHideErrors.circles ?? "ok"})`,
      );
    }
  }

  if (hadFallback) {
    console.log("cleanup completed with fallback preservation for at least one QA auth user");
  }
}

main().catch((error) => {
  console.error("cleanup-preview-test-accounts failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
