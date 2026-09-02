import { env as runtimeEnv } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { jsonResponse, requireForumUser, requireManagedCircleBySlug, requireManagedCircleForAuthenticatedUser } from "../../../../../lib/server/circle-management";
import { isModeratorRole } from "../../../../../lib/server/admin-auth";
import { requireAuthenticatedLegalConsent } from "../../../../../lib/server/legal-consent-mutation.server";
import { createLegalConsentReadRepository } from "../../../../../lib/server/legal-consent-repository.server";

export const prerender = false;

type RuntimeLocals = { runtime?: { env?: Record<string, string | undefined> } };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      .select("id, title")
      .eq("circle_id", auth.circle.id);

    if (postsError) return jsonResponse({ error: postsError.message }, 500);
    if ((posts ?? []).length === 0) return jsonResponse({ comments: [] });

    const postIds = (posts ?? []).map((post) => post.id);
    const postMap = new Map((posts ?? []).map((post) => [post.id, post.title]));

    const { data: comments, error: commentsError } = await auth.client
      .from("comments")
      .select("id, post_id, author_id, body, status, created_at, updated_at")
      .in("post_id", postIds)
      .order("created_at", { ascending: false });

    if (commentsError) return jsonResponse({ error: commentsError.message }, 500);

    const authorIds = [...new Set((comments ?? []).map((comment) => comment.author_id).filter(Boolean))];
    const { data: profiles, error: profilesError } = authorIds.length
      ? await auth.client.from("profiles").select("id, username, display_name, role").in("id", authorIds)
      : { data: [], error: null };

    if (profilesError) return jsonResponse({ error: profilesError.message }, 500);

    const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

    return jsonResponse({
      comments: (comments ?? []).map((comment) => {
        const author = profileMap.get(comment.author_id);
        return {
          ...comment,
          post_title: postMap.get(comment.post_id) ?? "未知帖子",
          can_manage: isStaff || comment.author_id === auth.user.id,
          author: author
            ? {
                id: author.id,
                username: author.username ?? null,
                display_name: author.display_name ?? null,
                role: author.role ?? null,
              }
            : null,
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
    const commentId = String(payload?.id ?? "").trim();
    const status = String(payload?.status ?? "").trim();

    if (!UUID_REGEX.test(commentId)) return jsonResponse({ error: "Invalid comment id" }, 400);
    if (!["published", "deleted"].includes(status)) {
      return jsonResponse({ error: "Unsupported comment status" }, 400);
    }

    const { data: existingComment, error: existingCommentError } = await auth.client
      .from("comments")
      .select("id, post_id, status, author_id")
      .eq("id", commentId)
      .maybeSingle();

    if (existingCommentError) return jsonResponse({ error: existingCommentError.message }, 500);
    if (!existingComment) return jsonResponse({ error: "Comment not found" }, 404);

    const { data: owningPost, error: owningPostError } = await auth.client
      .from("posts")
      .select("id")
      .eq("id", existingComment.post_id)
      .eq("circle_id", auth.circle.id)
      .maybeSingle();

    if (owningPostError) return jsonResponse({ error: owningPostError.message }, 500);
    if (!owningPost) return jsonResponse({ error: "Comment not found in this circle" }, 404);
    if (!isStaff && existingComment.author_id !== auth.user.id) {
      return jsonResponse({ error: "FORBIDDEN" }, 403);
    }
    if (existingComment.status === status) {
      return jsonResponse({ ok: true, comment: existingComment, unchanged: true });
    }

    let updateQuery = auth.client
      .from("comments")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", commentId);
    if (!isStaff) {
      updateQuery = updateQuery.eq("author_id", auth.user.id);
    }

    const { data: updated, error: updateError } = await updateQuery
      .select("id, post_id, status")
      .single();

    if (updateError) return jsonResponse({ error: updateError.message }, 500);
    return jsonResponse({ ok: true, comment: updated });
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
    const commentId = String(url.searchParams.get("id") ?? "").trim();
    if (!UUID_REGEX.test(commentId)) return jsonResponse({ error: "Invalid comment id" }, 400);

    const { data: existingComment, error: existingCommentError } = await auth.client
      .from("comments")
      .select("id, post_id, status, author_id")
      .eq("id", commentId)
      .maybeSingle();

    if (existingCommentError) return jsonResponse({ error: existingCommentError.message }, 500);
    if (!existingComment) return jsonResponse({ error: "Comment not found" }, 404);

    const { data: owningPost, error: owningPostError } = await auth.client
      .from("posts")
      .select("id")
      .eq("id", existingComment.post_id)
      .eq("circle_id", auth.circle.id)
      .maybeSingle();

    if (owningPostError) return jsonResponse({ error: owningPostError.message }, 500);
    if (!owningPost) return jsonResponse({ error: "Comment not found in this circle" }, 404);
    if (!isStaff && existingComment.author_id !== auth.user.id) {
      return jsonResponse({ error: "FORBIDDEN" }, 403);
    }
    if (existingComment.status === "deleted") {
      return jsonResponse({ ok: true, comment: existingComment, already_deleted: true });
    }

    let updateQuery = auth.client
      .from("comments")
      .update({ status: "deleted", updated_at: new Date().toISOString() })
      .eq("id", commentId);
    if (!isStaff) {
      updateQuery = updateQuery.eq("author_id", auth.user.id);
    }

    const { data: updated, error: updateError } = await updateQuery
      .select("id, post_id, status")
      .single();

    if (updateError) return jsonResponse({ error: updateError.message }, 500);
    return jsonResponse({ ok: true, comment: updated });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
  }
};

export const ALL: APIRoute = () => jsonResponse({ error: "Method not allowed" }, 405);
