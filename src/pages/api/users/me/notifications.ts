import type { APIRoute } from "astro";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireVerifiedApplicationSession } from "../../../../lib/server/application-session.ts";
import {
  buildNotificationHref,
  buildNotificationMessage,
  buildNotificationPreview,
  getNotificationActorName,
  isForumNotificationType,
  isNotificationResourceId,
  isSystemNotificationType,
  sortNotificationsByLatestEvent,
  type ForumNotificationType,
  type NotificationActor,
  type NotificationItem,
} from "../../../../lib/notifications";
import { resolveProfileAvatarUrl } from "../../../../lib/profile-media";
import { isPublicVisibleCircle } from "../../../../lib/site-navigation";
import { requireAuthenticatedLegalConsent } from "../../../../lib/server/legal-consent-mutation.server";
import { createLegalConsentReadRepository } from "../../../../lib/server/legal-consent-repository.server";

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
  circle_id: string | null;
  status: string | null;
  moderation_status: string | null;
};

type CommentRow = {
  id: string;
  body: string | null;
  post_id: string | null;
  status: string | null;
  moderation_status: string | null;
};

type CircleRow = {
  id: string;
  slug: string | null;
  name: string | null;
  status: string | null;
};

type NotificationQuery = { limit: number; unreadOnly: boolean };
type NotificationAction = { action: "mark_read"; notificationId: string } | { action: "mark_all_read" };
type AuthenticatedRequest = { client: SupabaseClient; userId: string };
type AuthenticationResult = AuthenticatedRequest | { error: Response };

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_PATCH_BODY_BYTES = 1024;
const NOTIFICATION_QUERY_KEYS = new Set(["limit", "unread_only"]);

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function hasRuntimeBindings(env: RuntimeEnv | undefined): env is RuntimeEnv & { SUPABASE_URL: string; SUPABASE_ANON_KEY: string } {
  return Boolean(env?.SUPABASE_URL && env.SUPABASE_ANON_KEY);
}

export function getBearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  const match = value?.match(/^Bearer ([^\s]+)$/i);
  return match?.[1] ?? null;
}

function createUserClient(env: RuntimeEnv & { SUPABASE_URL: string; SUPABASE_ANON_KEY: string }, bearerToken: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${bearerToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function parseNotificationQuery(url: URL): NotificationQuery | null {
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => !NOTIFICATION_QUERY_KEYS.has(key))) return null;
  if ([...NOTIFICATION_QUERY_KEYS].some((key) => url.searchParams.getAll(key).length > 1)) return null;

  const limitValue = url.searchParams.get("limit");
  if (limitValue !== null && !/^[1-9][0-9]{0,1}$/.test(limitValue)) return null;
  const limit = limitValue === null ? DEFAULT_LIMIT : Number(limitValue);
  if (limit > MAX_LIMIT) return null;

  const unreadValue = url.searchParams.get("unread_only");
  if (unreadValue !== null && unreadValue !== "true" && unreadValue !== "false" && unreadValue !== "1" && unreadValue !== "0") {
    return null;
  }

  return { limit, unreadOnly: unreadValue === "true" || unreadValue === "1" };
}

export function parseNotificationAction(value: unknown): NotificationAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  const keys = Object.keys(payload);
  if (payload.action === "mark_all_read" && keys.length === 1) return { action: "mark_all_read" };
  if (payload.action === "mark_read" && keys.length === 2 && typeof payload.notification_id === "string" && isNotificationResourceId(payload.notification_id)) {
    return { action: "mark_read", notificationId: payload.notification_id };
  }
  return null;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}

function nullableResourceId(value: unknown): string | null {
  return typeof value === "string" && isNotificationResourceId(value) ? value : null;
}

export function normalizeNotificationRow(value: unknown, recipientId: string): NotificationRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    !isNotificationResourceId(row.id) ||
    row.recipient_id !== recipientId ||
    !isForumNotificationType(row.type) ||
    !isTimestamp(row.created_at) ||
    !isTimestamp(row.last_event_at) ||
    (row.read_at !== null && row.read_at !== undefined && !isTimestamp(row.read_at))
  ) {
    return null;
  }

  return {
    id: row.id,
    recipient_id: recipientId,
    actor_id: nullableResourceId(row.actor_id),
    type: row.type,
    post_id: nullableResourceId(row.post_id),
    comment_id: nullableResourceId(row.comment_id),
    read_at: typeof row.read_at === "string" ? row.read_at : null,
    created_at: row.created_at,
    last_event_at: row.last_event_at,
  };
}

async function getUnreadCount(client: SupabaseClient, recipientId: string): Promise<number> {
  const { count, error } = await client
    .from("forum_notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", recipientId)
    .is("read_at", null);
  if (error) throw error;
  return count ?? 0;
}

async function loadNotificationRows(client: SupabaseClient, recipientId: string, query: NotificationQuery): Promise<NotificationRow[]> {
  let request = client
    .from("forum_notifications")
    .select("id, recipient_id, actor_id, type, post_id, comment_id, read_at, created_at, last_event_at")
    .eq("recipient_id", recipientId)
    .order("last_event_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(query.limit);
  if (query.unreadOnly) request = request.is("read_at", null);

  const { data, error } = await request;
  if (error) throw error;
  return ((data as unknown[] | null) ?? []).flatMap((row) => {
    const normalized = normalizeNotificationRow(row, recipientId);
    return normalized ? [normalized] : [];
  });
}

function isSameOriginAvatarUrl(value: string | null, userId: string): value is string {
  return Boolean(value && value === `/api/media/profile/${encodeURIComponent(userId)}/avatar`);
}

async function resolveActors(client: SupabaseClient, rows: NotificationRow[]): Promise<Map<string, NotificationActor>> {
  const actorIds = [...new Set(rows.map((row) => row.actor_id).filter((value): value is string => Boolean(value)))];
  if (actorIds.length === 0) return new Map();
  const { data, error } = await client.from("profiles").select("id, username, display_name, avatar_url").in("id", actorIds);
  if (error) throw error;

  const pairs = await Promise.all(
    ((data as ProfileRow[] | null) ?? [])
      .filter((row) => isNotificationResourceId(row.id))
      .map(async (row) => {
        const resolvedAvatarUrl = await resolveProfileAvatarUrl(client, row.avatar_url, undefined, { publicProxyUserId: row.id });
        return [
          row.id,
          {
            username: typeof row.username === "string" ? row.username : null,
            display_name: typeof row.display_name === "string" ? row.display_name : null,
            avatar_resolved_url: isSameOriginAvatarUrl(resolvedAvatarUrl, row.id) ? resolvedAvatarUrl : null,
          } satisfies NotificationActor,
        ] as const;
      }),
  );
  return new Map(pairs);
}

function isVisiblePost(row: PostRow, circle: CircleRow | undefined): boolean {
  return (
    isNotificationResourceId(row.id) &&
    isNotificationResourceId(row.circle_id) &&
    row.status === "published" &&
    row.moderation_status === "published" &&
    Boolean(circle && circle.id === row.circle_id && circle.status === "active" && isPublicVisibleCircle(circle))
  );
}

async function resolvePosts(client: SupabaseClient, rows: NotificationRow[]): Promise<Map<string, PostRow>> {
  const postIds = [...new Set(rows.map((row) => row.post_id).filter((value): value is string => Boolean(value)))];
  if (postIds.length === 0) return new Map();
  const { data, error } = await client.from("posts").select("id, title, circle_id, status, moderation_status").in("id", postIds);
  if (error) throw error;
  const postRows = (data as PostRow[] | null) ?? [];
  const circleIds = [...new Set(postRows.map((row) => row.circle_id).filter((value): value is string => isNotificationResourceId(value)))];
  if (circleIds.length === 0) return new Map();
  const { data: circleData, error: circleError } = await client.from("circles").select("id, slug, name, status").in("id", circleIds);
  if (circleError) throw circleError;
  const circles = new Map(((circleData as CircleRow[] | null) ?? []).filter((row) => isNotificationResourceId(row.id)).map((row) => [row.id, row]));
  return new Map(postRows.filter((row) => isVisiblePost(row, row.circle_id ? circles.get(row.circle_id) : undefined)).map((row) => [row.id, row]));
}

async function resolveComments(client: SupabaseClient, rows: NotificationRow[], posts: Map<string, PostRow>): Promise<Map<string, CommentRow>> {
  const commentIds = [...new Set(rows.map((row) => row.comment_id).filter((value): value is string => Boolean(value)))];
  if (commentIds.length === 0) return new Map();
  const { data, error } = await client.from("comments").select("id, body, post_id, status, moderation_status").in("id", commentIds);
  if (error) throw error;
  return new Map(
    ((data as CommentRow[] | null) ?? [])
      .filter((row) => isNotificationResourceId(row.id) && isNotificationResourceId(row.post_id) && row.status === "published" && row.moderation_status === "published" && posts.has(row.post_id))
      .map((row) => [row.id, row]),
  );
}

function buildNotificationItem(row: NotificationRow, actors: Map<string, NotificationActor>, posts: Map<string, PostRow>, comments: Map<string, CommentRow>): NotificationItem {
  const actor = row.actor_id ? actors.get(row.actor_id) : undefined;
  const fallbackActor: NotificationActor = { username: null, display_name: null, avatar_resolved_url: null };
  const comment = row.comment_id ? comments.get(row.comment_id) : undefined;
  const post = row.post_id ? posts.get(row.post_id) : undefined;
  const commentMatchesPost = Boolean(comment && (!row.post_id || row.post_id === comment.post_id));
  const safePost = commentMatchesPost && comment?.post_id ? posts.get(comment.post_id) : !row.comment_id ? post : undefined;
  const targetPostId = safePost?.id ?? null;
  const targetCommentId = commentMatchesPost ? comment?.id ?? null : null;
  const actorName = getNotificationActorName(actor ?? fallbackActor);
  const previewSource = isSystemNotificationType(row.type) || !targetPostId ? null : row.type === "post_like" ? safePost?.title ?? null : targetCommentId ? comment?.body ?? null : safePost?.title ?? null;

  return {
    id: row.id,
    type: row.type,
    created_at: row.created_at,
    last_event_at: row.last_event_at,
    read_at: row.read_at,
    href: buildNotificationHref(row.type, targetPostId, targetCommentId),
    actor: actor ?? fallbackActor,
    message: buildNotificationMessage(row.type, actorName),
    preview: buildNotificationPreview(row.type, previewSource),
  };
}

async function authenticate(request: Request, locals: unknown): Promise<AuthenticationResult> {
  const token = getBearerToken(request);
  if (!token) return { error: json({ ok: false, error: "UNAUTHORIZED" }, 401) };
  const env = (locals as { runtime?: { env?: RuntimeEnv } }).runtime?.env;
  if (!hasRuntimeBindings(env)) return { error: json({ ok: false, error: "NOTIFICATIONS_UNAVAILABLE" }, 500) };

  try {
    const session = await requireVerifiedApplicationSession(request, env);
    if (!isNotificationResourceId(session.user.id)) return { error: json({ ok: false, error: "UNAUTHORIZED" }, 401) };
    return { client: session.client, userId: session.user.id };
  } catch {
    return { error: json({ ok: false, error: "UNAUTHORIZED" }, 401) };
  }
}

type NotificationRouteDependencies = {
  authenticate: typeof authenticate;
  getUnreadCount: typeof getUnreadCount;
  loadNotificationRows: typeof loadNotificationRows;
  resolveActors: typeof resolveActors;
  resolvePosts: typeof resolvePosts;
  resolveComments: typeof resolveComments;
  requireAuthenticatedLegalConsent: typeof requireAuthenticatedLegalConsent;
  createLegalConsentReadRepository: typeof createLegalConsentReadRepository;
  now: () => string;
};

const productionDependencies: NotificationRouteDependencies = { authenticate, getUnreadCount, loadNotificationRows, resolveActors, resolvePosts, resolveComments, requireAuthenticatedLegalConsent, createLegalConsentReadRepository, now: () => new Date().toISOString() };

export function createNotificationsGet(dependencies: NotificationRouteDependencies = productionDependencies): APIRoute {
  return async ({ request, locals }) => {
    const auth = await dependencies.authenticate(request, locals);
    if ("error" in auth) return auth.error;
    const query = parseNotificationQuery(new URL(request.url));
    if (!query) return json({ ok: false, error: "INVALID_NOTIFICATION_QUERY" }, 400);

    try {
      const [unreadCount, rows] = await Promise.all([dependencies.getUnreadCount(auth.client, auth.userId), dependencies.loadNotificationRows(auth.client, auth.userId, query)]);
      const [actors, posts] = await Promise.all([dependencies.resolveActors(auth.client, rows), dependencies.resolvePosts(auth.client, rows)]);
      const comments = await dependencies.resolveComments(auth.client, rows, posts);
      return json({ ok: true, unread_count: unreadCount, notifications: sortNotificationsByLatestEvent(rows.map((row) => buildNotificationItem(row, actors, posts, comments))) });
    } catch {
      return json({ ok: false, error: "NOTIFICATIONS_FETCH_FAILED" }, 500);
    }
  };
}

export function createNotificationsPatch(dependencies: NotificationRouteDependencies = productionDependencies): APIRoute {
  return async ({ request, locals }) => {
    const auth = await dependencies.authenticate(request, locals);
    if ("error" in auth) return auth.error;
    const consent = await dependencies.requireAuthenticatedLegalConsent({
      identity: { userId: auth.userId },
      repository: dependencies.createLegalConsentReadRepository(auth.client),
    });
    if (!consent.ok) return consent.response;
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > MAX_PATCH_BODY_BYTES) return json({ ok: false, error: "INVALID_ACTION" }, 400);
    const contentType = request.headers.get("content-type");
    if (contentType && !/^application\/json(?:;|$)/i.test(contentType)) return json({ ok: false, error: "INVALID_ACTION" }, 400);
    const action = parseNotificationAction(await request.json().catch(() => null));
    if (!action) return json({ ok: false, error: "INVALID_ACTION" }, 400);

    try {
      const readAt = dependencies.now();
      let requestBuilder = auth.client.from("forum_notifications").update({ read_at: readAt }).eq("recipient_id", auth.userId).is("read_at", null);
      if (action.action === "mark_read") requestBuilder = requestBuilder.eq("id", action.notificationId);
      const { error } = await requestBuilder;
      if (error) return json({ ok: false, error: "NOTIFICATION_UPDATE_FAILED" }, 500);
      return json({ ok: true });
    } catch {
      return json({ ok: false, error: "NOTIFICATION_UPDATE_FAILED" }, 500);
    }
  };
}

export const GET: APIRoute = createNotificationsGet();
export const PATCH: APIRoute = createNotificationsPatch();
export const ALL: APIRoute = () => json({ ok: false, error: "Method not allowed" }, 405);
