import type { SupabaseClient } from "@supabase/supabase-js";
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

type SearchValidation =
  | { ok: true; query: string; type: ForumSearchType; pattern: string }
  | { ok: false; error: "INVALID_QUERY" };

function sanitizeSearchInput(raw: string): string {
  return raw
    .trim()
    .replace(/[%_]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, MAX_QUERY_LENGTH);
}

export function parseForumSearchParams(rawQuery: string, rawType: string | null | undefined): SearchValidation {
  const query = sanitizeSearchInput(rawQuery);
  const type: ForumSearchType =
    rawType === "posts" || rawType === "circles" || rawType === "all" ? rawType : "all";

  if (query.length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH) {
    return { ok: false, error: "INVALID_QUERY" };
  }

  return {
    ok: true,
    query,
    type,
    pattern: `%${query}%`,
  };
}

function isMissingCircleStatusError(message: string) {
  return /status/i.test(message) && /does not exist/i.test(message);
}

function buildExcerpt(body: string | null | undefined) {
  return String(body ?? "")
    .replace(/[#*_`>\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

export async function runForumSearch(
  supabase: SupabaseClient,
  params: { query: string; type: ForumSearchType },
): Promise<{ ok: true; results: ForumSearchResults } | { ok: false; error: "INVALID_QUERY" | "SEARCH_FAILED" }> {
  const parsed = parseForumSearchParams(params.query, params.type);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  try {
    const tasks: Array<Promise<ForumSearchPostResult[] | ForumSearchCircleResult[]>> = [];

    if (parsed.type === "all" || parsed.type === "posts") {
      tasks.push(
        supabase
          .from("posts")
          .select("id,title,body,created_at,type,circles:circle_id(slug,name),profiles:author_id(username,display_name)")
          .eq("status", "published")
          .or(`title.ilike.${parsed.pattern},body.ilike.${parsed.pattern}`)
          .order("created_at", { ascending: false })
          .limit(MAX_POST_RESULTS)
          .then(({ data, error }) => {
            if (error) throw error;
            return ((data ?? []) as Array<Record<string, unknown>>).map((post) => ({
              id: String(post.id),
              title: String(post.title ?? ""),
              excerpt: buildExcerpt(post.body as string | null | undefined),
              created_at: String(post.created_at ?? ""),
              type: typeof post.type === "string" ? post.type : null,
              circle: post.circles && typeof post.circles === "object"
                ? {
                    slug: typeof (post.circles as Record<string, unknown>).slug === "string"
                      ? ((post.circles as Record<string, unknown>).slug as string)
                      : null,
                    name: typeof (post.circles as Record<string, unknown>).name === "string"
                      ? ((post.circles as Record<string, unknown>).name as string)
                      : null,
                  }
                : null,
              author: post.profiles && typeof post.profiles === "object"
                ? {
                    username: typeof (post.profiles as Record<string, unknown>).username === "string"
                      ? ((post.profiles as Record<string, unknown>).username as string)
                      : null,
                    display_name: typeof (post.profiles as Record<string, unknown>).display_name === "string"
                      ? ((post.profiles as Record<string, unknown>).display_name as string)
                      : null,
                  }
                : null,
            })) as ForumSearchPostResult[];
          }),
      );
    } else {
      tasks.push(Promise.resolve([] as ForumSearchPostResult[]));
    }

    if (parsed.type === "all" || parsed.type === "circles") {
      tasks.push(
        supabase
          .from("circles")
          .select("id,slug,name,description,created_at,image_path,status")
          .eq("status", "active")
          .or(`name.ilike.${parsed.pattern},description.ilike.${parsed.pattern}`)
          .order("name", { ascending: true })
          .limit(MAX_CIRCLE_RESULTS)
          .then(async ({ data, error }) => {
            if (error && isMissingCircleStatusError(error.message)) {
              const fallback = await supabase
                .from("circles")
                .select("id,slug,name,description,created_at,image_path")
                .or(`name.ilike.${parsed.pattern},description.ilike.${parsed.pattern}`)
                .order("name", { ascending: true })
                .limit(MAX_CIRCLE_RESULTS);
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
          }),
      );
    } else {
      tasks.push(Promise.resolve([] as ForumSearchCircleResult[]));
    }

    const [posts, circles] = await Promise.all(tasks) as [ForumSearchPostResult[], ForumSearchCircleResult[]];

    return {
      ok: true,
      results: {
        query: parsed.query,
        type: parsed.type,
        posts,
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
} as const;
