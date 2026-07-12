import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  printQaWriteGuardError,
  readQaWriteGuardConfig,
  validateQaWriteTarget,
} from "./target-write-guard.mjs";

/**
 * QA cleanup success criteria:
 * - public QA posts/circles are no longer visible
 * - admin role is revoked for the QA admin account
 * - auth users are deleted, or disabled as an accepted fallback
 *
 * This is legacy compatibility cleanup: it discovers by owner and marker, not
 * exact run IDs. Future destructive QA must use exact-ID cleanup instead.
 */

const REQUIRED_ENV = [
  "QA_SUPABASE_URL",
  "QA_SUPABASE_SERVICE_ROLE_KEY",
  "QA_ORDINARY_EMAIL",
  "QA_ADMIN_EMAIL",
];

const DEFAULT_OUTPUT_DIR = ".tmp-qa/cleanup-runs";

function parseArgs(argv) {
  const options = {
    dryRun: false,
    marker: null,
    verbose: false,
    strictPublic: false,
    confirmRun: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--dry-run") options.dryRun = true;
    else if (value === "--verbose") options.verbose = true;
    else if (value === "--strict-public") options.strictPublic = true;
    else if (value === "--confirm-run") {
      options.confirmRun = String(argv[index + 1] ?? "").trim() || null;
      index += 1;
    }
    else if (value === "--marker") {
      options.marker = String(argv[index + 1] ?? "").trim() || null;
      index += 1;
    }
  }

  return options;
}

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

function redactId(id) {
  if (!id) return "unknown";
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
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

function resolveRuntimeConfig(env) {
  const dotEnv = loadDotEnv();
  const anonKey =
    process.env.PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    dotEnv.PUBLIC_SUPABASE_ANON_KEY ??
    dotEnv.SUPABASE_ANON_KEY ??
    null;

  return {
    baseUrl: String(
      process.env.QA_BASE_URL ??
        process.env.PREVIEW_URL ??
        dotEnv.QA_BASE_URL ??
        dotEnv.PREVIEW_URL ??
        "",
    ).replace(/\/+$/, ""),
    url: env.QA_SUPABASE_URL,
    anonKey,
    ordinaryPassword: process.env.QA_ORDINARY_PASSWORD ?? null,
    adminPassword: process.env.QA_ADMIN_PASSWORD ?? null,
  };
}

function isCanonicalProductionBaseUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === "openglasshub.pages.dev";
  } catch {
    return false;
  }
}

function validateRuntimeConfig(options, runtime, target) {
  if (!options.marker) {
    console.error("cleanup-preview-test-accounts requires --marker <disposable-marker>");
    process.exitCode = 1;
    return false;
  }

  if (!runtime.baseUrl) {
    console.error("cleanup-preview-test-accounts requires QA_BASE_URL or PREVIEW_URL to target a preview deployment");
    process.exitCode = 1;
    return false;
  }

  try {
    new URL(runtime.baseUrl);
  } catch {
    console.error("QA_WRITE_GUARD_FAILED: QA_BASE_URL_INVALID");
    process.exitCode = 1;
    return false;
  }

  if (isCanonicalProductionBaseUrl(runtime.baseUrl) && !target.productionTarget) {
    console.error("QA_WRITE_GUARD_FAILED: QA_BASE_URL_TARGET_MISMATCH");
    process.exitCode = 1;
    return false;
  }

  return true;
}

function sanitizeError(error) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/eyJ[A-Za-z0-9._-]+/g, "[redacted-jwt]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9._-]{24,}/g, "[redacted-token]");
}

function logVerbose(options, ...args) {
  if (options.verbose) console.log(...args);
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

async function createSignedInClient(config, email, password) {
  if (!config.url || !config.anonKey || !password) return { client: null, user: null, token: null, error: "MISSING_SIGNIN_CONFIG" };
  const client = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) {
    return { client: null, user: null, token: null, error: error?.message ?? "SIGN_IN_FAILED" };
  }
  return { client, user: data.user, token: data.session.access_token, error: null };
}

async function apiFetch(baseUrl, path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { status: response.status, ok: response.ok, text, json };
}

async function pageFetch(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, text: await response.text() };
}

async function discoverOwnedArtifacts(serviceClient, userClient, userId, options) {
  const discovered = {
    posts: [],
    comments: [],
    circles: [],
    mediaPaths: [],
    profile: null,
    errors: [],
  };

  if (userClient) {
    const [postsResult, commentsResult, circlesResult, mediaResult, profileResult] = await Promise.all([
      userClient.from("posts").select("id,title,status,circle_id").eq("author_id", userId).neq("status", "deleted"),
      userClient.from("comments").select("id,post_id,body,status").eq("author_id", userId).neq("status", "deleted"),
      userClient.from("circles").select("id,slug,name,status,image_path").eq("owner_id", userId).neq("status", "deleted"),
      userClient.from("post_media").select("id,post_id,storage_path,thumbnail_url").eq("user_id", userId),
      userClient.from("profiles").select("id,username,display_name,avatar_url,banner_url,role").eq("id", userId).maybeSingle(),
    ]);

    if (postsResult.error) discovered.errors.push(`discover_posts:${postsResult.error.message}`);
    else discovered.posts = postsResult.data ?? [];

    if (commentsResult.error) discovered.errors.push(`discover_comments:${commentsResult.error.message}`);
    else discovered.comments = commentsResult.data ?? [];

    if (circlesResult.error) discovered.errors.push(`discover_circles:${circlesResult.error.message}`);
    else discovered.circles = circlesResult.data ?? [];

    if (mediaResult.error) discovered.errors.push(`discover_media:${mediaResult.error.message}`);
    else {
      discovered.mediaPaths.push(
        ...(mediaResult.data ?? []).flatMap((row) => [row.storage_path ?? "", row.thumbnail_url ?? ""]),
      );
    }

    if (profileResult.error) discovered.errors.push(`discover_profile:${profileResult.error.message}`);
    else discovered.profile = profileResult.data ?? null;
  }

  const [postsService, commentsService, profileService, circlesService, mediaService] = await Promise.all([
    serviceClient
      .from("posts")
      .select("id,title,status,circle_id")
      .eq("author_id", userId)
      .neq("status", "deleted"),
    serviceClient
      .from("comments")
      .select("id,post_id,body,status")
      .eq("author_id", userId)
      .neq("status", "deleted"),
    serviceClient.from("profiles").select("avatar_url,banner_url").eq("id", userId).maybeSingle(),
    serviceClient.from("circles").select("id,slug,name,status,image_path").eq("owner_id", userId),
    serviceClient.from("post_media").select("storage_path,thumbnail_url").eq("user_id", userId),
  ]);

  if (!postsService.error) {
    for (const post of postsService.data ?? []) {
      if (!discovered.posts.some((item) => item.id === post.id)) {
        discovered.posts.push(post);
      }
    }
  }
  if (!commentsService.error) {
    for (const comment of commentsService.data ?? []) {
      if (!discovered.comments.some((item) => item.id === comment.id)) {
        discovered.comments.push(comment);
      }
    }
  }
  if (!profileService.error && profileService.data) {
    discovered.mediaPaths.push(profileService.data.avatar_url ?? "", profileService.data.banner_url ?? "");
  }
  if (!circlesService.error) {
    for (const circle of circlesService.data ?? []) {
      discovered.mediaPaths.push(circle.image_path ?? "");
      if (!discovered.circles.some((item) => item.id === circle.id)) {
        discovered.circles.push(circle);
      }
    }
  }
  if (!mediaService.error) {
    for (const media of mediaService.data ?? []) {
      discovered.mediaPaths.push(media.storage_path ?? "", media.thumbnail_url ?? "");
    }
  }

  discovered.mediaPaths = uniqueStrings(discovered.mediaPaths).filter((value) =>
    /^(profile-avatars|profile-banners|circle-covers|tmp\/|[0-9a-f-]{36}\/)/i.test(value),
  );

  logVerbose(options, "[cleanup] discovered artifacts", {
    userId: redactId(userId),
    posts: discovered.posts.length,
    comments: discovered.comments.length,
    circles: discovered.circles.length,
    mediaPaths: discovered.mediaPaths.length,
  });

  return discovered;
}

async function deleteOwnedComments(baseUrl, token, comments, options, dryRun) {
  const results = [];
  for (const comment of comments) {
    if (dryRun) {
      results.push({ id: comment.id, status: "DRY_RUN" });
      continue;
    }
    const response = await apiFetch(baseUrl, "/api/admin/moderation/hide", {
      method: "POST",
      token,
      body: {
        target_type: "comment",
        target_id: comment.id,
        reason: "qa_cleanup_marker",
      },
    });
    results.push({
      id: comment.id,
      status: response.status,
      ok: response.ok,
      error: response.ok ? null : response.json?.error ?? response.text ?? null,
    });
  }
  logVerbose(options, "[cleanup] comment delete results", results);
  return results;
}

async function deleteOwnedPosts(baseUrl, token, posts, options, dryRun) {
  const results = [];
  for (const post of posts) {
    if (dryRun) {
      results.push({ id: post.id, status: "DRY_RUN" });
      continue;
    }
    const response = await apiFetch(baseUrl, "/api/admin/moderation/hide", {
      method: "POST",
      token,
      body: {
        target_type: "post",
        target_id: post.id,
        reason: "qa_cleanup_marker",
      },
    });
    results.push({
      id: post.id,
      status: response.status,
      ok: response.ok,
      error: response.ok ? null : response.json?.error ?? response.text ?? null,
    });
  }
  logVerbose(options, "[cleanup] post delete results", results);
  return results;
}

async function deleteOwnedCircles(baseUrl, token, circles, options, dryRun) {
  const results = [];
  for (const circle of circles) {
    if (dryRun) {
      results.push({ id: circle.id, slug: circle.slug, status: "DRY_RUN" });
      continue;
    }
    const response = await apiFetch(baseUrl, "/api/admin/forum/circles", {
      method: "PATCH",
      token,
      body: {
        id: circle.id,
        status: "deleted",
      },
    });
    results.push({
      id: circle.id,
      slug: circle.slug,
      status: response.status,
      ok: response.ok,
      error: response.ok ? null : response.json?.error ?? response.text ?? null,
    });
  }
  logVerbose(options, "[cleanup] circle delete results", results);
  return results;
}

async function resetOwnedProfile(baseUrl, token, options, dryRun) {
  const result = {
    ok: true,
    status: dryRun ? "DRY_RUN" : "SKIPPED",
    error: null,
    skipped: true,
    reason: "PROFILE_RESET_NOT_REQUIRED_FOR_PREVIEW_CLEANUP",
  };
  logVerbose(options, "[cleanup] profile reset result", result);
  return result;
}

async function removeStorageObjects(client, paths, dryRun) {
  if (!paths.length) return { removed: 0, failed: 0, remaining: [] };
  if (dryRun) return { removed: 0, failed: 0, remaining: paths.slice(), dryRun: true };
  const { data, error } = await client.storage.from("post-media").remove(paths);
  if (error) {
    return { removed: 0, failed: paths.length, remaining: paths.slice(), error: error.message };
  }
  const removedNames = new Set(Array.isArray(data) ? data.map((item) => item?.name).filter(Boolean) : []);
  const remaining = paths.filter((path) => !removedNames.has(path));
  return { removed: removedNames.size, failed: remaining.length, remaining };
}

async function searchPublicArtifacts(baseUrl, marker) {
  if (!marker) return { status: null, posts: [], circles: [], raw: null };
  const response = await apiFetch(baseUrl, `/api/forum/search?q=${encodeURIComponent(marker)}`);
  return {
    status: response.status,
    posts: response.json?.results?.posts ?? [],
    circles: response.json?.results?.circles ?? [],
    raw: response.json ?? response.text,
  };
}

async function hidePublicPosts(baseUrl, token, posts, dryRun) {
  const results = [];
  for (const post of posts) {
    if (dryRun) {
      results.push({ id: post.id, status: "DRY_RUN" });
      continue;
    }
    const response = await apiFetch(baseUrl, "/api/admin/moderation/hide", {
      method: "POST",
      token,
      body: { target_type: "post", target_id: post.id, reason: "qa_cleanup" },
    });
    results.push({ id: post.id, status: response.status, ok: response.ok, error: response.ok ? null : response.json?.error ?? response.text ?? null });
  }
  return results;
}

async function deletePublicCircles(baseUrl, token, circles, dryRun) {
  const results = [];
  for (const circle of circles) {
    if (dryRun) {
      results.push({ id: circle.id, slug: circle.slug, status: "DRY_RUN" });
      continue;
    }
    const response = await apiFetch(baseUrl, "/api/admin/forum/circles", {
      method: "PATCH",
      token,
      body: { id: circle.id, status: "deleted" },
    });
    results.push({ id: circle.id, slug: circle.slug, status: response.status, ok: response.ok, error: response.ok ? null : response.json?.error ?? response.text ?? null });
  }
  return results;
}

async function verifyPublicSurface(baseUrl, marker, discoveredDirectUrls, strictPublic) {
  const verification = {
    marker,
    feed: null,
    search: null,
    circles: null,
    direct: [],
    publicLeak: false,
  };

  if (marker) {
    const [feedPage, circlesPage, searchResponse] = await Promise.all([
      pageFetch(baseUrl, "/feed/"),
      pageFetch(baseUrl, "/circles/"),
      apiFetch(baseUrl, `/api/forum/search?q=${encodeURIComponent(marker)}`),
    ]);
    verification.feed = {
      status: feedPage.status,
      hasMarker: feedPage.text.includes(marker),
    };
    verification.circles = {
      status: circlesPage.status,
      hasMarker: circlesPage.text.includes(marker),
    };
    verification.search = {
      status: searchResponse.status,
      posts: searchResponse.json?.results?.posts?.length ?? null,
      circles: searchResponse.json?.results?.circles?.length ?? null,
    };
    if (verification.feed.hasMarker || verification.circles.hasMarker || (verification.search.posts ?? 0) > 0 || (verification.search.circles ?? 0) > 0) {
      verification.publicLeak = true;
    }
  }

  for (const item of discoveredDirectUrls) {
    const page = await pageFetch(baseUrl, item.path);
    const visible = page.status === 200 && (!marker || page.text.includes(marker));
    verification.direct.push({
      label: item.label,
      path: item.path,
      status: page.status,
      visible,
    });
    if (visible) verification.publicLeak = true;
  }

  if (strictPublic && verification.publicLeak) {
    process.exitCode = 1;
  }

  return verification;
}

function failedActions(actions) {
  return actions.some((item) => item?.ok !== true && item?.status !== "DRY_RUN");
}

export function cleanupHasFailures(summary) {
  if (summary.verification?.publicLeak) return true;
  if (failedActions(summary.publicActions?.hiddenPosts ?? []) || failedActions(summary.publicActions?.deletedCircles ?? [])) return true;

  return summary.users.some((item) => {
    const ownerCleanup = item.ownerCleanup ?? {};
    return (
      (item.signInError && item.signInError !== "MISSING_SIGNIN_CONFIG") ||
      (item.discovery?.errors?.length ?? 0) > 0 ||
      failedActions(ownerCleanup.comments ?? []) ||
      failedActions(ownerCleanup.posts ?? []) ||
      failedActions(ownerCleanup.circles ?? []) ||
      (item.storage?.failed ?? 0) > 0 ||
      (item.label === "admin" && item.adminRoleRevoked !== true)
    );
  }) || summary.auth.some((item) => item.authDelete?.deleted !== true);
}

export function classificationFor(summary) {
  if (summary.verification.publicLeak) return "NO-GO_CLEANUP_PUBLIC_LEAK";
  if (cleanupHasFailures(summary)) return "NO-GO_CLEANUP_INCOMPLETE";
  const adminRoleProblem = summary.users.some((item) => item.label === "admin" && item.adminRoleRevoked !== true);
  if (adminRoleProblem) return "NO-GO_CLEANUP_AUTH_STATE";
  const authStateProblem = summary.auth.some((item) => item.authDelete.deleted !== true);
  if (authStateProblem) return "NO-GO_CLEANUP_AUTH_STATE";
  return "CLEANUP_OK";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const env = requireEnv();
  if (!env) return;

  let target;
  try {
    target = validateQaWriteTarget(readQaWriteGuardConfig(process.env, options.confirmRun));
  } catch (error) {
    printQaWriteGuardError(error);
    process.exitCode = 1;
    return;
  }

  const runtime = resolveRuntimeConfig(env);
  if (!validateRuntimeConfig(options, runtime, target)) return;

  if (options.dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      targetRef: target.actualRef,
      productionTarget: target.productionTarget,
      runLabel: target.safeRunLabel,
      marker: options.marker,
      legacyCleanup: true,
      plannedOperations: ["discover legacy QA-owned artifacts", "hide posts/comments", "delete circles/media", "revoke QA admin role", "delete or disable QA users", "verify public residue"],
    }, null, 2));
    return;
  }

  const serviceClient = createClient(env.QA_SUPABASE_URL, env.QA_SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const adminSignIn = await createSignedInClient(runtime, env.QA_ADMIN_EMAIL, runtime.adminPassword);
  const ordinarySignIn = await createSignedInClient(runtime, env.QA_ORDINARY_EMAIL, runtime.ordinaryPassword);

  const summary = {
    baseUrl: runtime.baseUrl,
    marker: options.marker,
    dryRun: options.dryRun,
    strictPublic: options.strictPublic,
    users: [],
    auth: [],
    publicActions: {
      hiddenPosts: [],
      deletedCircles: [],
    },
    verification: null,
  };

  const emails = [
    { email: env.QA_ORDINARY_EMAIL, label: "ordinary", password: runtime.ordinaryPassword, signIn: ordinarySignIn },
    { email: env.QA_ADMIN_EMAIL, label: "admin", password: runtime.adminPassword, signIn: adminSignIn },
  ];

  const discoveredDirectUrls = [];
  for (const { email, label, signIn } of emails) {
    const users = await listUsersByEmail(serviceClient, email);
    for (const user of users) {
      const userSummary = {
        label,
        email: redactEmail(email),
        userId: redactId(user.id),
        signInError: signIn.error ? sanitizeError(signIn.error) : null,
        discovery: null,
        ownerCleanup: {
          comments: [],
          posts: [],
          circles: [],
          profileReset: null,
        },
        storage: null,
        adminRoleRevoked: label === "admin" ? false : null,
      };

      const userClient = signIn.client;
      const token = signIn.token;
      const discovered = await discoverOwnedArtifacts(serviceClient, userClient, user.id, options);
      userSummary.discovery = {
        posts: discovered.posts.map((item) => ({ id: item.id, title: item.title ?? null, status: item.status ?? null })),
        comments: discovered.comments.map((item) => ({ id: item.id, post_id: item.post_id ?? null, status: item.status ?? null })),
        circles: discovered.circles.map((item) => ({ id: item.id, slug: item.slug ?? null, status: item.status ?? null })),
        mediaPaths: discovered.mediaPaths,
        errors: discovered.errors,
      };

      discoveredDirectUrls.push(
        ...discovered.posts.map((post) => ({ label: `post:${post.id}`, path: `/posts/${post.id}/` })),
        ...discovered.comments
          .filter((comment) => comment.post_id)
          .map((comment) => ({
            label: `comment:${comment.id}`,
            path: `/posts/${comment.post_id}/#comment-${comment.id}`,
          })),
        ...discovered.circles.filter((circle) => circle.slug).map((circle) => ({ label: `circle:${circle.slug}`, path: `/circles/${circle.slug}/` })),
      );

      if (adminSignIn.token) {
        userSummary.ownerCleanup.comments = await deleteOwnedComments(runtime.baseUrl, adminSignIn.token, discovered.comments, options, options.dryRun);
        userSummary.ownerCleanup.posts = await deleteOwnedPosts(runtime.baseUrl, adminSignIn.token, discovered.posts, options, options.dryRun);
        userSummary.ownerCleanup.circles = await deleteOwnedCircles(runtime.baseUrl, adminSignIn.token, discovered.circles, options, options.dryRun);
        userSummary.ownerCleanup.profileReset = await resetOwnedProfile(runtime.baseUrl, adminSignIn.token, options, options.dryRun);
      } else {
        userSummary.ownerCleanup.comments = discovered.comments.map((comment) => ({
          id: comment.id,
          status: null,
          ok: false,
          error: "ADMIN_SIGN_IN_UNAVAILABLE",
        }));
        userSummary.ownerCleanup.posts = discovered.posts.map((post) => ({
          id: post.id,
          status: null,
          ok: false,
          error: "ADMIN_SIGN_IN_UNAVAILABLE",
        }));
        userSummary.ownerCleanup.circles = discovered.circles.map((circle) => ({
          id: circle.id,
          slug: circle.slug,
          status: null,
          ok: false,
          error: "ADMIN_SIGN_IN_UNAVAILABLE",
        }));
        userSummary.ownerCleanup.profileReset = { ok: false, status: null, error: "ADMIN_SIGN_IN_UNAVAILABLE" };
      }

      userSummary.storage = await removeStorageObjects(serviceClient, discovered.mediaPaths, options.dryRun);

      if (label === "admin") {
        try {
          if (!options.dryRun) await revokeAdminRole(serviceClient, user.id);
          userSummary.adminRoleRevoked = true;
        } catch (error) {
          userSummary.adminRoleRevoked = sanitizeError(error);
        }
      }

      let authDelete = { deleted: false, error: "DRY_RUN" };
      let authDisable = { ok: false, error: "DRY_RUN" };
      if (!options.dryRun) {
        authDelete = await tryDeleteAuthUser(serviceClient, user.id);
        if (!authDelete.deleted) {
          authDisable = await disableAuthUser(serviceClient, user.id);
        }
      }
      summary.auth.push({
        label,
        email: redactEmail(email),
        userId: redactId(user.id),
        authDelete,
        authDisable,
        fallbackCode: !authDelete.deleted && authDisable.ok ? "AUTH_DELETE_FALLBACK_DISABLED" : null,
      });
      summary.users.push(userSummary);
    }
  }

  if (adminSignIn.token) {
    const publicArtifacts = await searchPublicArtifacts(runtime.baseUrl, options.marker);
    if ((publicArtifacts.posts?.length ?? 0) > 0) {
      summary.publicActions.hiddenPosts.push(
        ...(await hidePublicPosts(runtime.baseUrl, adminSignIn.token, publicArtifacts.posts, options.dryRun)),
      );
    }
    if ((publicArtifacts.circles?.length ?? 0) > 0) {
      summary.publicActions.deletedCircles.push(
        ...(await deletePublicCircles(runtime.baseUrl, adminSignIn.token, publicArtifacts.circles, options.dryRun)),
      );
    }
  }

  summary.verification = await verifyPublicSurface(runtime.baseUrl, options.marker, discoveredDirectUrls, options.strictPublic);
  summary.classification = classificationFor(summary);

  mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
  const outputPath = `${DEFAULT_OUTPUT_DIR}/cleanup-${Date.now()}.json`;
  writeFileSync(outputPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, outputPath }, null, 2));

  if (cleanupHasFailures(summary)) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error("cleanup-preview-test-accounts failed");
    console.error(sanitizeError(error));
    process.exitCode = 1;
  });
}
