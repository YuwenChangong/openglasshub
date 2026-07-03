import type { SupabaseClient } from "@supabase/supabase-js";
import type { ForumNotificationType } from "../notifications";

type ModerationNotificationType =
  | "post_moderated"
  | "comment_moderated"
  | "user_warned"
  | "user_restricted";

type CreateModerationNotificationParams = {
  client: SupabaseClient;
  recipientId: string | null | undefined;
  type: ModerationNotificationType;
  actingAdminId?: string | null;
  postId?: string | null;
  commentId?: string | null;
};

function normalizeId(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

async function createModerationNotification(params: CreateModerationNotificationParams): Promise<boolean> {
  const recipientId = normalizeId(params.recipientId);
  const actingAdminId = normalizeId(params.actingAdminId);
  const postId = normalizeId(params.postId);
  const commentId = normalizeId(params.commentId);

  if (!recipientId) return false;
  if (actingAdminId && recipientId === actingAdminId) return false;

  try {
    const { error } = await params.client.rpc("insert_forum_notification", {
      p_recipient_id: recipientId,
      p_actor_id: null,
      p_type: params.type satisfies ForumNotificationType,
      p_post_id: postId,
      p_comment_id: commentId,
      p_circle_id: null,
    });

    if (error) {
      console.warn("[moderation-notifications] create failed", {
        type: params.type,
        hasPostId: Boolean(postId),
        hasCommentId: Boolean(commentId),
        message: error.message,
      });
      return false;
    }

    return true;
  } catch (error) {
    console.warn("[moderation-notifications] create crashed", {
      type: params.type,
      hasPostId: Boolean(postId),
      hasCommentId: Boolean(commentId),
      message: error instanceof Error ? error.message : "unknown error",
    });
    return false;
  }
}

export async function notifyPostModerated(params: {
  client: SupabaseClient;
  recipientId: string | null | undefined;
  postId: string | null | undefined;
  actingAdminId?: string | null;
}) {
  return createModerationNotification({
    client: params.client,
    recipientId: params.recipientId,
    type: "post_moderated",
    actingAdminId: params.actingAdminId,
    postId: params.postId,
  });
}

export async function notifyCommentModerated(params: {
  client: SupabaseClient;
  recipientId: string | null | undefined;
  commentId: string | null | undefined;
  postId?: string | null;
  actingAdminId?: string | null;
}) {
  return createModerationNotification({
    client: params.client,
    recipientId: params.recipientId,
    type: "comment_moderated",
    actingAdminId: params.actingAdminId,
    postId: params.postId,
    commentId: params.commentId,
  });
}

export async function notifyUserWarned(params: {
  client: SupabaseClient;
  recipientId: string | null | undefined;
  actingAdminId?: string | null;
}) {
  return createModerationNotification({
    client: params.client,
    recipientId: params.recipientId,
    type: "user_warned",
    actingAdminId: params.actingAdminId,
  });
}

export async function notifyUserRestricted(params: {
  client: SupabaseClient;
  recipientId: string | null | undefined;
  actingAdminId?: string | null;
}) {
  return createModerationNotification({
    client: params.client,
    recipientId: params.recipientId,
    type: "user_restricted",
    actingAdminId: params.actingAdminId,
  });
}
