import type { APIRoute } from "astro";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildNotificationHref,
  buildNotificationMessage,
  buildNotificationPreview,
  getNotificationActorName,
  sortNotificationsByLatestEvent,
  type ForumNotificationType,
  type NotificationActor,
  type NotificationItem,
} from "../../../../lib/notifications";
import { resolveProfileAvatarUrl } from "../../../../lib/profile-media";

export const prerender = false;

type RuntimeEnv = Record<string, string | undefined>;

type NotificationRow = {
  id: string;
  recipient_id: string;
  actor_id: string | null;
  type: ForumNotificationType;
  post_id: string | null;
  comment_id: string | null;
  read_at: string | null;
  created_at: string;
  last_event_at: string;
};

type ProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

type PostRow = {
  id: string;
  title: string | null;
};

type CommentRow = {
  id: string;
  body: string | null;
  post_id: string | null;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function requireEnv(env: RuntimeEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

function getBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

function createUserClient(env: RuntimeEnv, bearerToken: string): SupabaseClient {
  return createClient(requireEnv(env, "SUPABASE_URL"), requireEnv(env, "SUPABASE_ANON_KEY"), {
    global: {
      headers: { Authorization: `Bearer ${bearerToken}` },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function parseBoolean(value: string | null): boolean {
  return value === "true" || value === "1";
}

function parseLimit(value: string | null): number {
  const parsed = Number(value ?? "");
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(parsed)));
}

async function getUnreadCount(client: SupabaseClient, recipientId: string): Promise<number> {
  const { count, error } = await client
    .from("forum_notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", recipientId)
    .is("read_at", null);

  if (error) {
    throw error;
  }

  return count ?? 0;
}

async function loadNotificationRows(
  client: SupabaseClient,
  recipientId: string,
  limit: number,
  unreadOnly: boolean,
): Promise<NotificationRow[]> {
  let query = client
    .from("forum_notifications")
    .select("id, recipient_id, actor_id, type, post_id, comment_id, read_at, created_at, last_event_at")
    .eq("recipient_id", recipientId)
    .order("last_event_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (unreadOnly) {
    query = query.is("read_at", null);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return (data as NotificationRow[] | null) ?? [];
}

async function resolveActors(client: SupabaseClient, rows: NotificationRow[]): Promise<Map<string, NotificationActor>> {
  const actorIds = [...new Set(rows.map((row) => row.actor_id).filter((value): value is string => Boolean(value)))];
  if (actorIds.length === 0) return new Map();

  const { data, error } = await client
    .from("profiles")
    .select("id, username, display_name, avatar_url")
    .in("id", actorIds);

  if (error) {
    throw error;
  }

  const baseRows = (data as ProfileRow[] | null) ?? [];
  const resolvedPairs = await Promise.all(
    baseRows.map(async (row) => {
      const avatarResolvedUrl = await resolveProfileAvatarUrl(client, row.avatar_url);
      return [
        row.id,
        {
          id: row.id,
          username: row.username,
          display_name: row.display_name,
          avatar_url: row.avatar_url,
          avatar_resolved_url: avatarResolvedUrl,
        } satisfies NotificationActor,
      ] as const;
    }),
  );

  return new Map(resolvedPairs);
}

async function resolvePosts(client: SupabaseClient, rows: NotificationRow[]): Promise<Map<string, PostRow>> {
  const postIds = [...new Set(rows.map((row) => row.post_id).filter((value): value is string => Boolean(value)))];
  if (postIds.length === 0) return new Map();

  const { data, error } = await client
    .from("posts")
    .select("id, title")
    .in("id", postIds);

  if (error) {
    throw error;
  }

  return new Map(((data as PostRow[] | null) ?? []).map((row) => [row.id, row]));
}

async function resolveComments(client: SupabaseClient, rows: NotificationRow[]): Promise<Map<string, CommentRow>> {
  const commentIds = [...new Set(rows.map((row) => row.comment_id).filter((value): value is string => Boolean(value)))];
  if (commentIds.length === 0) return new Map();

  const { data, error } = await client
    .from("comments")
    .select("id, body, post_id")
    .in("id", commentIds);

  if (error) {
    throw error;
  }

  return new Map(((data as CommentRow[] | null) ?? []).map((row) => [row.id, row]));
}

function buildNotificationItem(
  row: NotificationRow,
  actors: Map<string, NotificationActor>,
  posts: Map<string, PostRow>,
  comments: Map<string, CommentRow>,
): NotificationItem {
  const actor = row.actor_id ? actors.get(row.actor_id) : undefined;
  const fallbackActor: NotificationActor = {
    id: row.actor_id,
    username: null,
    display_name: null,
    avatar_url: null,
    avatar_resolved_url: null,
  };
  const post = row.post_id ? posts.get(row.post_id) : null;
  const comment = row.comment_id ? comments.get(row.comment_id) : null;
  const actorName = getNotificationActorName(actor ?? fallbackActor);
  const previewSource =
    row.type === "post_like"
      ? post?.title ?? comment?.body ?? null
      : comment?.body ?? post?.title ?? null;

  return {
    id: row.id,
    type: row.type,
    created_at: row.created_at,
    last_event_at: row.last_event_at,
    read_at: row.read_at,
    post_id: row.post_id,
    comment_id: row.comment_id,
    href: buildNotificationHref(row.post_id ?? comment?.post_id ?? null, row.comment_id),
    actor: actor ?? fallbackActor,
    message: buildNotificationMessage(row.type, actorName),
    preview: buildNotificationPreview(row.type, previewSource),
  };
}

async function authenticate(request: Request, locals: unknown): Promise<{
  env: RuntimeEnv;
  client: SupabaseClient;
  userId: string;
} | { error: Response }> {
  const env = (locals as { runtime?: { env?: RuntimeEnv } }).runtime?.env;
  if (!env) {
    return { error: json({ ok: false, error: "UNAUTHORIZED" }, 500) };
  }

  const token = getBearerToken(request);
  if (!token) {
    return { error: json({ ok: false, error: "UNAUTHORIZED" }, 401) };
  }

  const client = createUserClient(env, token);
  const { data: authData, error: authError } = await client.auth.getUser(token);
  if (authError || !authData.user) {
    return { error: json({ ok: false, error: "UNAUTHORIZED" }, 401) };
  }

  return { env, client, userId: authData.user.id };
}

export const GET: APIRoute = async ({ request, locals }) => {
  const auth = await authenticate(request, locals);
  if ("error" in auth) return auth.error;

  try {
    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const unreadOnly = parseBoolean(url.searchParams.get("unread_only"));
    const [unreadCount, rows] = await Promise.all([
      getUnreadCount(auth.client, auth.userId),
      loadNotificationRows(auth.client, auth.userId, limit, unreadOnly),
    ]);
    const [actors, posts, comments] = await Promise.all([
      resolveActors(auth.client, rows),
      resolvePosts(auth.client, rows),
      resolveComments(auth.client, rows),
    ]);

    return json({
      ok: true,
      unread_count: unreadCount,
      notifications: sortNotificationsByLatestEvent(
        rows.map((row) => buildNotificationItem(row, actors, posts, comments)),
      ),
    });
  } catch (error) {
    console.warn("[notifications] fetch failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return json({ ok: false, error: "NOTIFICATIONS_FETCH_FAILED" }, 500);
  }
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  const auth = await authenticate(request, locals);
  if ("error" in auth) return auth.error;

  try {
    const payload = (await request.json().catch(() => null)) as
      | { notification_id?: string; action?: string }
      | null;

    if (!payload) {
      return json({ ok: false, error: "INVALID_ACTION" }, 400);
    }

    const action = String(payload.action ?? "").trim();
    if (action !== "mark_read" && action !== "mark_all_read") {
      return json({ ok: false, error: "INVALID_ACTION" }, 400);
    }

    if (action === "mark_read") {
      const notificationId = String(payload.notification_id ?? "").trim();
      if (!UUID_REGEX.test(notificationId)) {
        return json({ ok: false, error: "INVALID_NOTIFICATION_ID" }, 400);
      }

      const { error } = await auth.client
        .from("forum_notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", notificationId)
        .eq("recipient_id", auth.userId);

      if (error) {
        console.warn("[notifications] mark_read failed", { message: error.message });
        return json({ ok: false, error: "NOTIFICATION_UPDATE_FAILED" }, 500);
      }

      return json({ ok: true });
    }

    const { error } = await auth.client
      .from("forum_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_id", auth.userId)
      .is("read_at", null);

    if (error) {
      console.warn("[notifications] mark_all_read failed", { message: error.message });
      return json({ ok: false, error: "NOTIFICATION_UPDATE_FAILED" }, 500);
    }

    return json({ ok: true });
  } catch (error) {
    console.warn("[notifications] update failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return json({ ok: false, error: "NOTIFICATION_UPDATE_FAILED" }, 500);
  }
};

export const ALL: APIRoute = () => json({ ok: false, error: "Method not allowed" }, 405);
