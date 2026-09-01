import { env as runtimeEnv } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { jsonResponse, requireModerator, type RuntimeEnv } from "../../../../lib/server/admin-auth";
import { sanitizeBodyForDisplay } from "../../../../lib/post-body";

export const prerender = false;

type RuntimeLocals = { runtime?: { env?: RuntimeEnv } };
const IMPLEMENTATION = "admin_reports_manual_merge_v2";

function excerpt(text: string | null | undefined): string {
  return sanitizeBodyForDisplay(text ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function nonEmptyErrorMessage(message: string | null | undefined, fallback: string): string {
  const normalized = String(message ?? "").trim();
  return normalized || fallback;
}

function errorResponse(
  error: string,
  status: number,
  details?: string | null,
): Response {
  const payload: { error: string; implementation: string; details?: string } = {
    error: nonEmptyErrorMessage(error, "Unexpected server error"),
    implementation: IMPLEMENTATION,
  };

  const normalizedDetails = String(details ?? "").trim();
  if (normalizedDetails) {
    payload.details = normalizedDetails;
  }

  return jsonResponse(payload, status);
}

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const env = runtimeEnv;
    if (!env) return errorResponse("Runtime environment not available", 500);

    const { client } = await requireModerator(request, env);
    const url = new URL(request.url);
    const limitRaw = Number.parseInt(String(url.searchParams.get("limit") ?? "100"), 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 200)) : 100;

    const { data: reports, error } = await client
      .from("reports")
      .select("id,target_id,target_type,reporter_id,reason,status,created_at")
      .eq("target_type", "post")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return errorResponse(error.message, 500, error.details);

    const targetIds = Array.from(
      new Set(
        (reports ?? [])
          .map((row) => String(row.target_id ?? "").trim())
          .filter(Boolean),
      ),
    );

    const reporterIds = Array.from(
      new Set(
        (reports ?? [])
          .map((row) => String(row.reporter_id ?? "").trim())
          .filter(Boolean),
      ),
    );

    const postMap = new Map<string, {
      id: string;
      title: string | null;
      body: string | null;
      status: string | null;
      author_id: string | null;
      circle_id: string | null;
      created_at: string | null;
      updated_at: string | null;
    }>();
    const circleMap = new Map<string, { id: string; name: string | null; slug: string | null }>();
    const profileMap = new Map<string, { id: string; username: string | null; display_name: string | null; avatar_url: string | null; role: string | null }>();

    if (targetIds.length > 0) {
      const { data: posts, error: postsError } = await client
        .from("posts")
        .select("id,title,body,status,author_id,circle_id,created_at,updated_at")
        .in("id", targetIds);
      if (postsError) return errorResponse(postsError.message, 500, postsError.details);

      for (const post of posts ?? []) {
        postMap.set(post.id, {
          id: post.id,
          title: post.title ?? null,
          body: post.body ?? null,
          status: post.status ?? null,
          author_id: post.author_id ?? null,
          circle_id: post.circle_id ?? null,
          created_at: post.created_at ?? null,
          updated_at: post.updated_at ?? null,
        });
      }

      const circleIds = Array.from(
        new Set(
          (posts ?? [])
            .map((post) => String(post.circle_id ?? "").trim())
            .filter(Boolean),
        ),
      );

      if (circleIds.length > 0) {
        const { data: circles, error: circlesError } = await client
          .from("circles")
          .select("id,name,slug")
          .in("id", circleIds);
        if (circlesError) return errorResponse(circlesError.message, 500, circlesError.details);

        for (const circle of circles ?? []) {
          circleMap.set(circle.id, {
            id: circle.id,
            name: circle.name ?? null,
            slug: circle.slug ?? null,
          });
        }
      }

      const profileIds = Array.from(
        new Set(
          [
            ...reporterIds,
            ...(posts ?? [])
              .map((post) => String(post.author_id ?? "").trim())
              .filter(Boolean),
          ],
        ),
      );

      if (profileIds.length > 0) {
        const { data: profiles, error: profilesError } = await client
          .from("profiles")
          .select("id,username,display_name,avatar_url,role")
          .in("id", profileIds);
        if (profilesError) return errorResponse(profilesError.message, 500, profilesError.details);

        for (const profile of profiles ?? []) {
          profileMap.set(profile.id, {
            id: profile.id,
            username: profile.username ?? null,
            display_name: profile.display_name ?? null,
            avatar_url: profile.avatar_url ?? null,
            role: profile.role ?? null,
          });
        }
      }
    } else if (reporterIds.length > 0) {
      const { data: profiles, error: profilesError } = await client
        .from("profiles")
        .select("id,username,display_name,avatar_url,role")
        .in("id", reporterIds);
      if (profilesError) return errorResponse(profilesError.message, 500, profilesError.details);

      for (const profile of profiles ?? []) {
        profileMap.set(profile.id, {
          id: profile.id,
          username: profile.username ?? null,
          display_name: profile.display_name ?? null,
          avatar_url: profile.avatar_url ?? null,
          role: profile.role ?? null,
        });
      }
    }

    return jsonResponse({
      ok: true,
      implementation: IMPLEMENTATION,
      reports: (reports ?? []).map((row) => {
        const targetId = String(row.target_id ?? "").trim();
        const post = row.target_type === "post" ? postMap.get(targetId) ?? null : null;
        const authorProfile = post?.author_id ? profileMap.get(post.author_id) ?? null : null;
        const reporterProfile = row.reporter_id ? profileMap.get(String(row.reporter_id)) ?? null : null;
        const circle = post?.circle_id ? circleMap.get(post.circle_id) ?? null : null;

        return {
          id: row.id,
          reason: row.reason ?? "",
          status: row.status ?? null,
          target_type: row.target_type ?? null,
          target_id: targetId || null,
          reporter_id: row.reporter_id ?? null,
          created_at: row.created_at ?? null,
          reporter_profile: reporterProfile,
          post: post
            ? {
                id: post.id,
                title: post.title ?? null,
                body_excerpt: excerpt(post.body),
                status: post.status ?? null,
                author_id: post.author_id ?? null,
                author_profile: authorProfile,
                circle,
                created_at: post.created_at,
                updated_at: post.updated_at,
              }
            : null,
        };
      }),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return errorResponse(
      error instanceof Error ? error.message : "Unexpected server error",
      500,
    );
  }
};

export const ALL: APIRoute = () => errorResponse("Method not allowed", 405);
