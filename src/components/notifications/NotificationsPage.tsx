import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { useBrowserAuthState } from "../auth/useBrowserAuthState";
import type { NotificationItem } from "../../lib/notifications";

type NotificationsPayload = {
  ok: true;
  unread_count: number;
  notifications: NotificationItem[];
};

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (!Number.isFinite(diff)) return value;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))} 分钟前`;
  if (diff < day) return `${Math.max(1, Math.floor(diff / hour))} 小时前`;
  return `${Math.max(1, Math.floor(diff / day))} 天前`;
}

function getInitial(label?: string | null): string {
  return (label?.trim().charAt(0) || "U").toUpperCase();
}

export default function NotificationsPage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const { status, user } = useBrowserAuthState(supabase);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [markingAll, setMarkingAll] = useState(false);

  const loadNotifications = useCallback(async () => {
    if (status !== "signed_in" || !user || !supabase) {
      setNotifications([]);
      setUnreadCount(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("UNAUTHORIZED");

      const response = await fetch("/api/users/me/notifications?limit=50", {
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      const payload = (await response.json().catch(() => null)) as NotificationsPayload | { error?: string } | null;
      if (!response.ok || !payload || !("ok" in payload)) {
        throw new Error((payload as { error?: string } | null)?.error || "NOTIFICATIONS_FETCH_FAILED");
      }

      setUnreadCount(payload.unread_count);
      setNotifications(payload.notifications);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "NOTIFICATIONS_FETCH_FAILED");
    } finally {
      setLoading(false);
    }
  }, [status, supabase, user]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  const markRead = useCallback(async (notificationId: string) => {
    if (!supabase) return;
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) return;

      const response = await fetch("/api/users/me/notifications", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          action: "mark_read",
          notification_id: notificationId,
        }),
      });
      if (!response.ok) return;

      const wasUnread = notifications.some((item) => item.id === notificationId && item.read_at === null);
      setNotifications((current) =>
        current.map((item) => (item.id === notificationId ? { ...item, read_at: new Date().toISOString() } : item)),
      );
      if (wasUnread) {
        setUnreadCount((current) => Math.max(0, current - 1));
      }
    } catch {
      // navigation should still work
    }
  }, [notifications, supabase]);

  const handleOpenNotification = useCallback(async (event: MouseEvent<HTMLAnchorElement>, notification: NotificationItem) => {
    event.preventDefault();
    await markRead(notification.id);
    window.location.assign(notification.href);
  }, [markRead]);

  const markAllRead = useCallback(async () => {
    if (markingAll || !supabase) return;
    setMarkingAll(true);
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) return;

      const response = await fetch("/api/users/me/notifications", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ action: "mark_all_read" }),
      });
      if (!response.ok) return;

      setUnreadCount(0);
      setNotifications((current) => current.map((item) => ({
        ...item,
        read_at: item.read_at ?? new Date().toISOString(),
      })));
    } finally {
      setMarkingAll(false);
    }
  }, [markingAll, supabase]);

  if (status === "checking" || loading) {
    return <section className="community-empty"><strong>加载通知中...</strong></section>;
  }

  if (status !== "signed_in" || !user) {
    return <section className="community-empty"><strong>请先登录后查看通知</strong></section>;
  }

  if (error) {
    return <section className="community-empty"><strong>通知加载失败</strong></section>;
  }

  return (
    <section className="notifications-page">
      <div className="community-stream-head notifications-page__head">
        <div>
          <h2>通知</h2>
          <span className="community-meta">未读 {unreadCount}</span>
        </div>
        <button
          type="button"
          className="community-action-button"
          onClick={() => void markAllRead()}
          disabled={markingAll || unreadCount < 1}
        >
          {markingAll ? "处理中..." : "全部已读"}
        </button>
      </div>

      {notifications.length === 0 ? (
        <section className="community-empty">
          <strong>暂无通知</strong>
        </section>
      ) : (
        <div className="notifications-page__list">
          {notifications.map((notification) => {
            const actorLabel = notification.actor.display_name || notification.actor.username || "有人";
            const unread = notification.read_at === null;

            return (
              <a
                key={notification.id}
                href={notification.href}
                className={`notifications-page__item${unread ? " is-unread" : ""}`}
                onClick={(event) => void handleOpenNotification(event, notification)}
              >
                {notification.actor.avatar_resolved_url ? (
                  <img src={notification.actor.avatar_resolved_url} alt="" className="notifications-page__avatar" />
                ) : (
                  <span className="notifications-page__avatar notifications-page__avatar--fallback" aria-hidden="true">
                    {getInitial(actorLabel)}
                  </span>
                )}
                <span className="notifications-page__copy">
                  <strong>{notification.message}</strong>
                  {notification.preview ? <span>{notification.preview}</span> : null}
                  <small>{formatRelativeTime(notification.created_at)}</small>
                </span>
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}
