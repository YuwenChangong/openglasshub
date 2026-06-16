export type ForumNotificationType =
  | "comment_on_post"
  | "reply_to_comment"
  | "post_like"
  | "comment_like";

export interface NotificationActor {
  id: string | null;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  avatar_resolved_url: string | null;
}
export interface NotificationItem {
  id: string;
  type: ForumNotificationType;
  created_at: string;
  last_event_at: string;
  read_at: string | null;
  post_id: string | null;
  comment_id: string | null;
  href: string;
  actor: NotificationActor;
  message: string;
  preview: string | null;
}

export function getNotificationActorName(actor: Pick<NotificationActor, "display_name" | "username" | "id">): string {
  return actor.display_name?.trim() || actor.username?.trim() || (actor.id ? `${actor.id.slice(0, 6)}…${actor.id.slice(-4)}` : "有人");
}

export function buildNotificationHref(postId?: string | null, commentId?: string | null): string {
  if (!postId) return "/notifications/";
  if (commentId) return `/posts/${encodeURIComponent(postId)}/#comment-${encodeURIComponent(commentId)}`;
  return `/posts/${encodeURIComponent(postId)}/`;
}

export function buildNotificationMessage(type: ForumNotificationType, actorName: string): string {
  switch (type) {
    case "comment_on_post":
      return `${actorName} 评论了你的帖子`;
    case "reply_to_comment":
      return `${actorName} 回复了你的评论`;
    case "post_like":
      return `${actorName} 赞了你的帖子`;
    case "comment_like":
      return `${actorName} 赞了你的评论`;
    default:
      return `${actorName} 与你互动了`;
  }
}

export function buildNotificationPreview(type: ForumNotificationType, previewSource?: string | null): string | null {
  const value = previewSource?.replace(/\s+/g, " ").trim();
  if (!value) return null;
  const shortened = value.length > 48 ? `${value.slice(0, 48)}…` : value;
  if (type === "post_like" || type === "comment_on_post") {
    return shortened;
  }
  return shortened;
}

function toTimestamp(value?: string | null): number {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function sortNotificationsByLatestEvent<T extends Pick<NotificationItem, "created_at" | "last_event_at">>(
  items: T[],
): T[] {
  return [...items].sort((left, right) => {
    const lastEventDelta = toTimestamp(right.last_event_at) - toTimestamp(left.last_event_at);
    if (lastEventDelta !== 0) return lastEventDelta;
    return toTimestamp(right.created_at) - toTimestamp(left.created_at);
  });
}
