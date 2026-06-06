import type { SupabaseClient } from "@supabase/supabase-js";
import { buildResolvedPostMediaMap, type PostMediaRow } from "./forum-media";
import { buildPostCommentCountMap, buildPostLikeCountMap, isMissingViewCountError } from "./post-engagement";
import { isPublicVisibleCircle } from "./site-navigation";
import type {
  ForumSearchCircleResult,
  ForumSearchPostResult,
  ForumSearchResults,
  ForumSearchType,
} from "./search-types";

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 80;
const MAX_POST_RESULTS = 20;
const MAX_CIRCLE_RESULTS = 20;
const DEFAULT_PREVIEW_POST_LIMIT = 3;
const EXCERPT_LENGTH = 15;

type SearchValidation =
  | { ok: true; query: string; type: ForumSearchType; pattern: string; circleSlug: string | null }
  | { ok: false; error: "INVALID_QUERY" };

type SearchPostRow = {
  id: string;
  title: string;
  body: string | null;
  created_at: string;
  type: string | null;
  author_id?: string | null;
  view_count?: number | null;
  circles?: { slug?: string | null; name?: string | null } | null;
  profiles?: { username?: string | null; display_name?: string | null } | null;
  post_media?: PostMediaRow[] | null;
};

function sanitizeSearchInput(raw: string): string {
  return raw
    .trim()
    .replace(/[%_]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, MAX_QUERY_LENGTH);
}

function sanitizeCircleSlug(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").trim().toLowerCase();
  return value ? value.slice(0, 80) : null;
}

export function parseForumSearchParams(
  rawQuery: string,
  rawType: string | null | undefined,
  rawCircle?: string | null | undefined,
): SearchValidation {
  const query = sanitizeSearchInput(rawQuery);
  const circleSlug = sanitizeCircleSlug(rawCircle);
  const type: ForumSearchType =
    circleSlug
      ? "posts"
      : rawType === "posts" || rawType === "circles" || rawType === "all"
        ? rawType
        : "all";

  if (query.length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH) {
    return { ok: false, error: "INVALID_QUERY" };
  }

  return {
    ok: true,
    query,
    type,
    circleSlug,
    pattern: `%${query}%`,
  };
}

function isMissingCircleStatusError(message: string) {
  return /status/i.test(message) && /does not exist/i.test(message);
}

function buildExcerpt(body: string | null | undefined) {
  const text = String(body ?? "")
    .replace(/[#*_`>\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length <= EXCERPT_LENGTH) {
    return text;
  }

  return `${text.slice(0, EXCERPT_LENGTH)}...`;
}

function normalizePostRow(post: Record<string, unknown>): SearchPostRow {
  return {
    id: String(post.id ?? ""),
    title: String(post.title ?? ""),
    body: typeof post.body === "string" ? post.body : null,
    created_at: String(post.created_at ?? ""),
    type: typeof post.type === "string" ? post.type : null,
    author_id: typeof post.author_id === "string" ? post.author_id : null,
    view_count: typeof post.view_count === "number" ? post.view_count : null,
    circles:
      post.circles && typeof post.circles === "object"
        ? {
            slug:
              typeof (post.circles as Record<string, unknown>).slug === "string"
                ? ((post.circles as Record<string, unknown>).slug as string)
                : null,
            name:
              typeof (post.circles as Record<string, unknown>).name === "string"
                ? ((post.circles as Record<string, unknown>).name as string)
                : null,
          }
        : null,
    profiles:
      post.profiles && typeof post.profiles === "object"
        ? {
            username:
              typeof (post.profiles as Record<string, unknown>).username === "string"
                ? ((post.profiles as Record<string, unknown>).username as string)
                : null,
            display_name:
              typeof (post.profiles as Record<string, unknown>).display_name === "string"
                ? ((post.profiles as Record<string, unknown>).display_name as string)
                : null,
          }
        : null,
    post_media: Array.isArray(post.post_media) ? (post.post_media as PostMediaRow[]) : null,
  };
}

async function resolveCircleIdForSearch(supabase: SupabaseClient, circleSlug: string): Promise<string | null> {
  let { data: circle, error } = await supabase
    .from("circles")
    .select("id, slug, name, status")
    .eq("slug", circleSlug)
    .eq("status", "active")
    .maybeSingle();

  if (error && isMissingCircleStatusError(error.message)) {
    const fallback = await supabase
      .from("circles")
      .select("id, slug, name")
      .eq("slug", circleSlug)
      .maybeSingle();
    circle = fallback.data ? { ...fallback.data, status: "active" } : null;
    error = fallback.error;
  }

  if (error || !circle || !isPublicVisibleCircle(circle)) {
    return null;
  }

  return String(circle.id);
}

async function fetchMatchingAuthorIds(supabase: SupabaseClient, pattern: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .or(`username.ilike.${pattern},display_name.ilike.${pattern}`)
    .limit(25);

  if (error || !data) {
    return [];
  }

  return (data as Array<{ id: string | null }>).map((row) => row.id).filter((id): id is string => Boolean(id));
}

async function fetchPublishedPosts(
  supabase: SupabaseClient,
  params: {
    pattern: string;
    circleId: string | null;
    authorIds: string[];
    maxFetch: number;
  },
): Promise<{ rows: SearchPostRow[]; supportsViewCount: boolean }> {
  const selectWithViewCount =
    "id,title,body,created_at,type,author_id,view_count,circles:circle_id(slug,name),profiles:author_id(username,display_name),post_media(*)";
  const selectWithoutViewCount =
    "id,title,body,created_at,type,author_id,circles:circle_id(slug,name),profiles:author_id(username,display_name),post_media(*)";

  const buildQuery = (selectClause: string) => {
    let query = supabase
      .from("posts")
      .select(selectClause)
      .eq("status", "published")
      .or(`title.ilike.${params.pattern},body.ilike.${params.pattern}`)
      .order("created_at", { ascending: false })
      .limit(params.maxFetch);

    if (params.circleId) {
      query = query.eq("circle_id", params.circleId);
    }

    return query;
  };

  let supportsViewCount = true;
  let textResult = await buildQuery(selectWithViewCount);

  if (textResult.error && isMissingViewCountError(textResult.error)) {
    supportsViewCount = false;
    textResult = await buildQuery(selectWithoutViewCount);
  }

  if (textResult.error) {
    throw textResult.error;
  }

  const merged = new Map<string, SearchPostRow>();
  for (const row of (textResult.data ?? []) as Array<Record<string, unknown>>) {
    const normalized = normalizePostRow(row);
    merged.set(normalized.id, normalized);
  }

  if (params.authorIds.length > 0) {
    const authorSelect = supportsViewCount ? selectWithViewCount : selectWithoutViewCount;
    let authorQuery = supabase
      .from("posts")
      .select(authorSelect)
      .eq("status", "published")
      .in("author_id", params.authorIds)
      .order("created_at", { ascending: false })
      .limit(params.maxFetch);

    if (params.circleId) {
      authorQuery = authorQuery.eq("circle_id", params.circleId);
    }

    const authorResult = await authorQuery;
    if (authorResult.error && supportsViewCount && isMissingViewCountError(authorResult.error)) {
      supportsViewCount = false;
      let fallbackAuthorQuery = supabase
        .from("posts")
        .select(selectWithoutViewCount)
        .eq("status", "published")
        .in("author_id", params.authorIds)
        .order("created_at", { ascending: false })
        .limit(params.maxFetch);
      if (params.circleId) {
        fallbackAuthorQuery = fallbackAuthorQuery.eq("circle_id", params.circleId);
      }
      const fallbackAuthorResult = await fallbackAuthorQuery;
      if (fallbackAuthorResult.error) throw fallbackAuthorResult.error;
      for (const row of (fallbackAuthorResult.data ?? []) as Array<Record<string, unknown>>) {
        const normalized = normalizePostRow(row);
        merged.set(normalized.id, normalized);
      }
    } else if (authorResult.error) {
      throw authorResult.error;
    } else {
      for (const row of (authorResult.data ?? []) as Array<Record<string, unknown>>) {
        const normalized = normalizePostRow(row);
        merged.set(normalized.id, normalized);
      }
    }
  }

  return {
    rows: [...merged.values()],
    supportsViewCount,
  };
}

export async function runForumSearch(
  supabase: SupabaseClient,
  params: {
    query: string;
    type: ForumSearchType;
    circleSlug?: string | null;
    limitPosts?: number;
    limitCircles?: number;
    r2PublicBaseUrl?: string;
  },
): Promise<{ ok: true; results: ForumSearchResults } | { ok: false; error: "INVALID_QUERY" | "SEARCH_FAILED" }> {
  const parsed = parseForumSearchParams(params.query, params.type, params.circleSlug);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  try {
    const circleId = parsed.circleSlug ? await resolveCircleIdForSearch(supabase, parsed.circleSlug) : null;
    if (parsed.circleSlug && !circleId) {
      return {
        ok: true,
        results: {
          query: parsed.query,
          type: "posts",
          circle: parsed.circleSlug,
          posts: [],
          circles: [],
        },
      };
    }

    const limitPosts = Math.min(Math.max(params.limitPosts ?? MAX_POST_RESULTS, 1), MAX_POST_RESULTS);
    const limitCircles = Math.min(Math.max(params.limitCircles ?? MAX_CIRCLE_RESULTS, 1), MAX_CIRCLE_RESULTS);

    const authorIds = parsed.type === "circles" ? [] : await fetchMatchingAuthorIds(supabase, parsed.pattern);

    const postsPromise =
      parsed.type === "all" || parsed.type === "posts"
        ? fetchPublishedPosts(supabase, {
            pattern: parsed.pattern,
            circleId,
            authorIds,
            maxFetch: Math.max(limitPosts * 4, 40),
          })
        : Promise.resolve({ rows: [], supportsViewCount: true });

    const circlesPromise =
      parsed.circleSlug || parsed.type === "posts"
        ? Promise.resolve([] as ForumSearchCircleResult[])
        : supabase
            .from("circles")
            .select("id,slug,name,description,created_at,image_path,status")
            .eq("status", "active")
            .or(`name.ilike.${parsed.pattern},description.ilike.${parsed.pattern}`)
            .order("name", { ascending: true })
            .limit(limitCircles)
            .then(async ({ data, error }) => {
              if (error && isMissingCircleStatusError(error.message)) {
                const fallback = await supabase
                  .from("circles")
                  .select("id,slug,name,description,created_at,image_path")
                  .or(`name.ilike.${parsed.pattern},description.ilike.${parsed.pattern}`)
                  .order("name", { ascending: true })
                  .limit(limitCircles);
                if (fallback.error) throw fallback.error;
                return ((fallback.data ?? []) as Array<Record<string, unknown>>)
                  .map((circle) => ({
                    id: String(circle.id),
                    slug: String(circle.slug ?? ""),
                    name: String(circle.name ?? ""),
                    description: typeof circle.description === "string" ? circle.description : null,
                    created_at: typeof circle.created_at === "string" ? circle.created_at : null,
                    image_path: typeof circle.image_path === "string" ? circle.image_path : null,
                    status: "active",
                  }))
                  .filter((circle) => isPublicVisibleCircle(circle));
              }
              if (error) throw error;
              return ((data ?? []) as Array<Record<string, unknown>>)
                .map((circle) => ({
                  id: String(circle.id),
                  slug: String(circle.slug ?? ""),
                  name: String(circle.name ?? ""),
                  description: typeof circle.description === "string" ? circle.description : null,
                  created_at: typeof circle.created_at === "string" ? circle.created_at : null,
                  image_path: typeof circle.image_path === "string" ? circle.image_path : null,
                  status: typeof circle.status === "string" ? circle.status : null,
                }))
                .filter((circle) => isPublicVisibleCircle(circle)) as ForumSearchCircleResult[];
            });

    const [{ rows: matchedPosts, supportsViewCount }, circles] = await Promise.all([postsPromise, circlesPromise]);

    const limitedPosts = matchedPosts.slice(0, Math.max(limitPosts * 4, 40));
    const postIds = limitedPosts.map((post) => post.id);
    const [likeCountMap, commentCountMap, mediaMap] = await Promise.all([
      buildPostLikeCountMap(supabase, postIds),
      buildPostCommentCountMap(supabase, postIds),
      buildResolvedPostMediaMap(
        supabase,
        limitedPosts.map((post) => ({ id: post.id, post_media: post.post_media ?? [] })),
        60 * 60,
        params.r2PublicBaseUrl,
      ),
    ]);

    const sortedPosts = [...limitedPosts]
      .sort((left, right) => {
        const leftScore =
          (commentCountMap.get(left.id) ?? 0) * 3 +
          (likeCountMap.get(left.id) ?? 0) * 2 +
          Number(supportsViewCount ? left.view_count ?? 0 : 0);
        const rightScore =
          (commentCountMap.get(right.id) ?? 0) * 3 +
          (likeCountMap.get(right.id) ?? 0) * 2 +
          Number(supportsViewCount ? right.view_count ?? 0 : 0);

        if (rightScore !== leftScore) return rightScore - leftScore;
        return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
      })
      .slice(0, limitPosts)
      .map((post) => {
        const previewImage = (mediaMap.get(post.id) ?? []).find((item) => item.kind === "image") ?? null;
        return {
          id: post.id,
          title: post.title,
          excerpt: buildExcerpt(post.body),
          created_at: post.created_at,
          type: post.type,
          preview_image_url: previewImage?.previewUrl || previewImage?.displayUrl || null,
          circle: post.circles
            ? {
                slug: post.circles.slug ?? null,
                name: post.circles.name ?? null,
              }
            : null,
          author:
            post.author_id || post.profiles
              ? {
                  id: post.author_id ?? null,
                  username: post.profiles?.username ?? null,
                  display_name: post.profiles?.display_name ?? null,
                }
              : null,
        } satisfies ForumSearchPostResult;
      });

    return {
      ok: true,
      results: {
        query: parsed.query,
        type: parsed.type,
        circle: parsed.circleSlug,
        posts: sortedPosts,
        circles,
      },
    };
  } catch (error) {
    console.warn("[forum-search] search failed", error instanceof Error ? error.message : String(error));
    return { ok: false, error: "SEARCH_FAILED" };
  }
}

export const FORUM_SEARCH_LIMITS = {
  minQueryLength: MIN_QUERY_LENGTH,
  maxQueryLength: MAX_QUERY_LENGTH,
  maxPostResults: MAX_POST_RESULTS,
  maxCircleResults: MAX_CIRCLE_RESULTS,
  previewPostResults: DEFAULT_PREVIEW_POST_LIMIT,
} as const;
