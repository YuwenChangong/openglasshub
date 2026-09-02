import { env as runtimeEnv } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { requireForumUser, requireManagedCircleBySlug, requireManagedCircleForAuthenticatedUser, jsonResponse } from "../../../../../lib/server/circle-management";
import { isModeratorRole } from "../../../../../lib/server/admin-auth";
import { requireAuthenticatedLegalConsent } from "../../../../../lib/server/legal-consent-mutation.server";
import { createLegalConsentReadRepository } from "../../../../../lib/server/legal-consent-repository.server";

export const prerender = false;

type RuntimeLocals = { runtime?: { env?: Record<string, string | undefined> } };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function authorLabel(profile?: { display_name?: string | null; username?: string | null } | null, fallback?: string | null) {
  return profile?.display_name || profile?.username || fallback || "未知用户";
}

export const GET: APIRoute = async ({ request, params, locals }) => {
  try {
    const env = runtimeEnv;
    const slug = String(params.slug ?? "").trim().toLowerCase();
    if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);
    if (!slug) return jsonResponse({ error: "Missing circle slug" }, 400);

    const auth = await requireManagedCircleBySlug({ request, env, slug });
    const isStaff = isModeratorRole(auth.profile.role);
    const { data: posts, error: postsError } = await auth.client
      .from("posts")
      .select("id, title, status, author_id, created_at, updated_at")
      .eq("circle_id", auth.circle.id)
      .order("created_at", { ascending: false });

    if (postsError) return jsonResponse({ error: postsError.message }, 500);

    const postIds = (posts ?? []).map((post) => post.id);
    const authorIds = [...new Set((posts ?? []).map((post) => post.author_id).filter(Boolean))];

    const [{ data: profiles, error: profilesError }, { data: mediaRows, error: mediaError }, { data: reports, error: reportsError }] = await Promise.all([
      authorIds.length
        ? auth.client.from("profiles").select("id, username, display_name, role").in("id", authorIds)
        : Promise.resolve({ data: [], error: null }),
      postIds.length
        ? auth.client.from("post_media").select("id, post_id").in("post_id", postIds)
        : Promise.resolve({ data: [], error: null }),
      postIds.length
        ? auth.client.from("reports").select("id, target_id").eq("target_type", "post").in("target_id", postIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (profilesError) return jsonResponse({ error: profilesError.message }, 500);
    if (mediaError) return jsonResponse({ error: mediaError.message }, 500);
    if (reportsError) return jsonResponse({ error: reportsError.message }, 500);

    const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    const mediaCountMap = new Map<string, number>();
    const reportCountMap = new Map<string, number>();

    for (const row of mediaRows ?? []) {
      mediaCountMap.set(row.post_id, (mediaCountMap.get(row.post_id) ?? 0) + 1);
    }
    for (const row of reports ?? []) {
      reportCountMap.set(row.target_id, (reportCountMap.get(row.target_id) ?? 0) + 1);
    }

    return jsonResponse({
      posts: (posts ?? []).map((post) => {
        const profile = profileMap.get(post.author_id);
        return {
          ...post,
          author: profile
            ? {
                id: profile.id,
                username: profile.username ?? null,
                display_name: profile.display_name ?? null,
                role: profile.role ?? null,
                label: authorLabel(profile, post.author_id),
              }
            : null,
          can_manage: isStaff || post.author_id === auth.user.id,
          media_count: mediaCountMap.get(post.id) ?? 0,
          report_count: reportCountMap.get(post.id) ?? 0,
        };
      }),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
};

export const PATCH: APIRoute = async ({ request, params, locals }) => {
  try {
    const env = runtimeEnv;
    const slug = String(params.slug ?? "").trim().toLowerCase();
    if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);
    if (!slug) return jsonResponse({ error: "Missing circle slug" }, 400);

    const forumAuth = await requireForumUser(request, env);
    const consent = await requireAuthenticatedLegalConsent({
      identity: { userId: forumAuth.user.id },
      repository: createLegalConsentReadRepository(forumAuth.client),
    });
    if (!consent.ok) return consent.response;
    const auth = await requireManagedCircleForAuthenticatedUser({ auth: forumAuth, slug });
    const isStaff = isModeratorRole(auth.profile.role);
    const payload = (await request.json().catch(() => null)) as { id?: string; status?: string } | null;
    const postId = String(payload?.id ?? "").trim();
    const status = String(payload?.status ?? "").trim();

    if (!UUID_REGEX.test(postId)) return jsonResponse({ error: "Invalid post id" }, 400);
    if (!["published", "hidden", "deleted"].includes(status)) {
      return jsonResponse({ error: "Unsupported post status" }, 400);
    }

    const { data: existingPost, error: existingPostError } = await auth.client
      .from("posts")
      .select("id, circle_id, status, author_id")
      .eq("id", postId)
      .maybeSingle();

    if (existingPostError) return jsonResponse({ error: existingPostError.message }, 500);
    if (!existingPost || existingPost.circle_id !== auth.circle.id) {
      return jsonResponse({ error: "Post not found in this circle" }, 404);
    }
    if (!isStaff && existingPost.author_id !== auth.user.id) {
      return jsonResponse({ error: "FORBIDDEN" }, 403);
    }
    if (existingPost.status === status) {
      return jsonResponse({ ok: true, post: existingPost, unchanged: true });
    }

    let updateQuery = auth.client
      .from("posts")
      .update({ status })
      .eq("id", postId)
      .eq("circle_id", auth.circle.id);
    if (!isStaff) {
      updateQuery = updateQuery.eq("author_id", auth.user.id);
    }

    const { data: updated, error: updateError } = await updateQuery
      .select("id, circle_id, status")
      .single();

    if (updateError) return jsonResponse({ error: updateError.message }, 500);
    return jsonResponse({ ok: true, post: updated });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
};

export const DELETE: APIRoute = async ({ request, params, locals }) => {
  try {
    const env = runtimeEnv;
    const slug = String(params.slug ?? "").trim().toLowerCase();
    if (!env) return jsonResponse({ error: "Runtime environment not available" }, 500);
    if (!slug) return jsonResponse({ error: "Missing circle slug" }, 400);

    const forumAuth = await requireForumUser(request, env);
    const consent = await requireAuthenticatedLegalConsent({
      identity: { userId: forumAuth.user.id },
      repository: createLegalConsentReadRepository(forumAuth.client),
    });
    if (!consent.ok) return consent.response;
    const auth = await requireManagedCircleForAuthenticatedUser({ auth: forumAuth, slug });
    const isStaff = isModeratorRole(auth.profile.role);
    const url = new URL(request.url);
    const postId = String(url.searchParams.get("id") ?? "").trim();
    if (!UUID_REGEX.test(postId)) return jsonResponse({ error: "Invalid post id" }, 400);

    const { data: existingPost, error: existingPostError } = await auth.client
      .from("posts")
      .select("id, circle_id, status, author_id")
      .eq("id", postId)
      .maybeSingle();

    if (existingPostError) return jsonResponse({ error: existingPostError.message }, 500);
    if (!existingPost || existingPost.circle_id !== auth.circle.id) {
      return jsonResponse({ error: "Post not found in this circle" }, 404);
    }
    if (!isStaff && existingPost.author_id !== auth.user.id) {
      return jsonResponse({ error: "FORBIDDEN" }, 403);
    }
    if (existingPost.status === "deleted") {
      return jsonResponse({ ok: true, post: existingPost, already_deleted: true });
    }

    let updateQuery = auth.client
      .from("posts")
      .update({ status: "deleted" })
      .eq("id", postId)
      .eq("circle_id", auth.circle.id);
    if (!isStaff) {
      updateQuery = updateQuery.eq("author_id", auth.user.id);
    }

    const { data: updated, error: updateError } = await updateQuery
      .select("id, circle_id, status")
      .single();

    if (updateError) return jsonResponse({ error: updateError.message }, 500);
    return jsonResponse({ ok: true, post: updated });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
};

export const ALL: APIRoute = () => jsonResponse({ error: "Method not allowed" }, 405);
