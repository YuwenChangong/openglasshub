import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv, type RuntimeEnv } from "./admin-auth.ts";

type ModerationNotificationType =
  | "post_moderated"
  | "comment_moderated"
  | "user_warned"
  | "user_restricted";

type ModerationNotificationCommand =
  | { type: "post_moderated"; recipientId: string; postId: string }
  | { type: "comment_moderated"; recipientId: string; postId: string; commentId: string }
  | { type: "user_warned"; recipientId: string }
  | { type: "user_restricted"; recipientId: string };

type NotificationRpcClient = Pick<SupabaseClient, "rpc">;

export type ModerationNotificationWriter = {
  send(command: ModerationNotificationCommand): Promise<boolean>;
};

type ModerationNotificationWriterDependencies = {
  createServiceClient?: (env: RuntimeEnv) => NotificationRpcClient;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return uuidPattern.test(value);
}

function createModerationNotificationServiceClient(env: RuntimeEnv): NotificationRpcClient {
  return createClient(requireEnv(env, "SUPABASE_URL"), requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function normalizeCommand(command: ModerationNotificationCommand): {
  recipientId: string;
  type: ModerationNotificationType;
  postId: string | null;
  commentId: string | null;
} | null {
  if (!isUuid(command.recipientId)) return null;

  if (command.type === "post_moderated") {
    return isUuid(command.postId)
      ? { recipientId: command.recipientId, type: command.type, postId: command.postId, commentId: null }
      : null;
  }
  if (command.type === "comment_moderated") {
    return isUuid(command.postId) && isUuid(command.commentId)
      ? { recipientId: command.recipientId, type: command.type, postId: command.postId, commentId: command.commentId }
      : null;
  }
  if (command.type === "user_warned" || command.type === "user_restricted") {
    return { recipientId: command.recipientId, type: command.type, postId: null, commentId: null };
  }
  return null;
}

// Routes create this only after verified moderator authorization and consent.
// The service-role client remains lazy until an authorized action reaches its notification stage.
export function createModerationNotificationWriter(
  env: RuntimeEnv,
  verifiedActorId: string,
  dependencies: ModerationNotificationWriterDependencies = {},
): ModerationNotificationWriter {
  const createServiceClient = dependencies.createServiceClient ?? createModerationNotificationServiceClient;

  return {
    async send(command) {
      const normalized = normalizeCommand(command);
      if (!normalized || !isUuid(verifiedActorId) || normalized.recipientId === verifiedActorId) return false;

      try {
        const client = createServiceClient(env);
        const { error } = await client.rpc("insert_forum_notification", {
          p_recipient_id: normalized.recipientId,
          p_actor_id: verifiedActorId,
          p_type: normalized.type,
          p_post_id: normalized.postId,
          p_comment_id: normalized.commentId,
          p_circle_id: null,
        });
        return !error;
      } catch {
        return false;
      }
    },
  };
}

export function notifyPostModerated(
  writer: ModerationNotificationWriter,
  params: { recipientId: string; postId: string },
) {
  return writer.send({ type: "post_moderated", recipientId: params.recipientId, postId: params.postId });
}

export function notifyCommentModerated(
  writer: ModerationNotificationWriter,
  params: { recipientId: string; postId: string; commentId: string },
) {
  return writer.send({ type: "comment_moderated", recipientId: params.recipientId, postId: params.postId, commentId: params.commentId });
}

export function notifyUserWarned(writer: ModerationNotificationWriter, recipientId: string) {
  return writer.send({ type: "user_warned", recipientId });
}

export function notifyUserRestricted(writer: ModerationNotificationWriter, recipientId: string) {
  return writer.send({ type: "user_restricted", recipientId });
}
