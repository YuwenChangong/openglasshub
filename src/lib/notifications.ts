export const forumNotificationTypes = [
  "comment_on_post",
  "reply_to_comment",
  "post_like",
  "comment_like",
  "post_moderated",
  "comment_moderated",
  "user_warned",
  "user_restricted",
] as const;

export type ForumNotificationType = (typeof forumNotificationTypes)[number];

export interface NotificationActor {
  username: string | null;
  display_name: string | null;
  avatar_resolved_url: string | null;
}

export interface NotificationItem {
  id: string;
  type: ForumNotificationType;
  created_at: string;
  last_event_at: string;
  read_at: string | null;
  href: string;
  actor: NotificationActor;
  message: string;
  preview: string | null;
}

const notificationTypeSet = new Set<string>(forumNotificationTypes);
const resourceIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isForumNotificationType(value: unknown): value is ForumNotificationType {
  return typeof value === "string" && notificationTypeSet.has(value);
}

export function isNotificationResourceId(value: unknown): value is string {
  return typeof value === "string" && resourceIdPattern.test(value);
}

export function isSystemNotificationType(type: ForumNotificationType): boolean {
  return type === "post_moderated" || type === "comment_moderated" || type === "user_warned" || type === "user_restricted";
}

export function getNotificationActorName(actor: Pick<NotificationActor, "display_name" | "username">): string {
  return actor.display_name?.trim() || actor.username?.trim() || "有人";
}

export function getNotificationVisualLabel(type: ForumNotificationType, actor: Pick<NotificationActor, "display_name" | "username">): string {
  return isSystemNotificationType(type) ? "系统" : getNotificationActorName(actor);
}

export function buildNotificationHref(type: ForumNotificationType, postId?: string | null, commentId?: string | null): string {
  if (!isForumNotificationType(type) || isSystemNotificationType(type) || !isNotificationResourceId(postId)) return "/notifications/";
  if (commentId && !isNotificationResourceId(commentId)) return "/notifications/";
  if (commentId) return `/posts/${postId}/#comment-${commentId}`;
  return `/posts/${postId}/`;
}

export function buildNotificationMessage(type: ForumNotificationType, actorName: string): string {
  switch (type) {
    case "comment_on_post": return `${actorName} 评论了你的帖子`;
    case "reply_to_comment": return `${actorName} 回复了你的评论`;
    case "post_like": return `${actorName} 赞了你的帖子`;
    case "comment_like": return `${actorName} 赞了你的评论`;
    case "post_moderated": return "Your post was removed after review.";
    case "comment_moderated": return "Your comment was removed after review.";
    case "user_warned": return "You received a warning after a moderation review.";
    case "user_restricted": return "Your account access was restricted after a moderation review.";
  }
}

function normalizeNotificationText(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

export function buildNotificationPreview(type: ForumNotificationType, previewSource?: string | null): string | null {
  if (isSystemNotificationType(type) || !previewSource) return null;
  const value = normalizeNotificationText(previewSource);
  return value ? (value.length > 48 ? `${value.slice(0, 48)}…` : value) : null;
}

function toTimestamp(value?: string | null): number {
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function sortNotificationsByLatestEvent<T extends Pick<NotificationItem, "id" | "created_at" | "last_event_at">>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    const lastEventDelta = toTimestamp(right.last_event_at) - toTimestamp(left.last_event_at);
    if (lastEventDelta !== 0) return lastEventDelta;
    const createdDelta = toTimestamp(right.created_at) - toTimestamp(left.created_at);
    return createdDelta || right.id.localeCompare(left.id);
  });
}
