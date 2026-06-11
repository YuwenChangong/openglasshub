import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserSupabaseClient, syncBrowserRealtimeAuth } from "../../lib/supabase-browser";
import { useBrowserAuthState } from "../auth/useBrowserAuthState";

type NotificationsPayload = {
  ok: true;
  unread_count: number;
};

type NotificationsState =
  | { status: "idle" | "loading" }
  | { status: "ready"; unreadCount: number }
  | { status: "error" };

function clampUnreadCount(value: number): string {
  if (value > 99) return "99+";
  return String(Math.max(0, value));
}

function NotificationBellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M8.25 18.25h7.5m-9-1.5h10.5c-.82-.86-1.5-2.56-1.5-5.03 0-2.2-1.53-4.1-3.75-4.58V6.5a1.5 1.5 0 1 0-3 0v.64C6.78 7.62 5.25 9.52 5.25 11.72c0 2.47-.68 4.17-1.5 5.03Zm3.75 1.5a2.25 2.25 0 0 0 4.5 0"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function HeaderNotifications() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const { status, user } = useBrowserAuthState(supabase);
  const [notificationsState, setNotificationsState] = useState<NotificationsState>({ status: "idle" });

  const loadUnreadCount = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!supabase || status !== "signed_in" || !user) {
      setNotificationsState({ status: "idle" });
      return;
    }

    if (!silent) {
      setNotificationsState((current) => (current.status === "ready" ? current : { status: "loading" }));
    }

    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) {
        if (!silent) setNotificationsState({ status: "error" });
        return;
      }

      const response = await fetch("/api/users/me/notifications?limit=1&unread_only=1", {
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        if (!silent) setNotificationsState({ status: "error" });
        return;
      }

      const payload = (await response.json().catch(() => null)) as NotificationsPayload | null;
      if (payload?.ok) {
        setNotificationsState({ status: "ready", unreadCount: Math.max(0, payload.unread_count) });
      } else if (!silent) {
        setNotificationsState({ status: "error" });
      }
    } catch {
      if (!silent) {
        setNotificationsState({ status: "error" });
      }
    }
  }, [status, supabase, user]);

  useEffect(() => {
    if (status !== "signed_in" || !user) {
      setNotificationsState({ status: "idle" });
      return;
    }

    void loadUnreadCount();
  }, [loadUnreadCount, status, user]);

  useEffect(() => {
    if (!supabase || status !== "signed_in" || !user) return;

    let cancelled = false;
    let channel: ReturnType<NonNullable<typeof supabase>["channel"]> | null = null;

    const setupChannel = async () => {
      const accessToken = await syncBrowserRealtimeAuth(supabase);
      if (!accessToken || cancelled) return;

      channel = supabase
        .channel(`forum-notifications-header-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "forum_notifications",
            filter: `recipient_id=eq.${user.id}`,
          },
          () => {
            void loadUnreadCount({ silent: true });
          },
        )
        .subscribe((subscriptionStatus) => {
          if (import.meta.env.DEV) {
            console.debug("[realtime] header notifications", { subscriptionStatus, userId: user.id });
          }
        });
    };

    void setupChannel();

    return () => {
      cancelled = true;
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [loadUnreadCount, status, supabase, user]);

  if (status === "checking" || status !== "signed_in" || !user) {
    return null;
  }

  const unreadCount = notificationsState.status === "ready" ? notificationsState.unreadCount : 0;

  return (
    <a
      href="/notifications/"
      className="header-notifications__trigger"
      aria-label={unreadCount > 0 ? `通知，${clampUnreadCount(unreadCount)} 条未读` : "通知"}
      title="通知"
    >
      <NotificationBellIcon />
      {unreadCount > 0 ? <span className="header-notifications__badge">{clampUnreadCount(unreadCount)}</span> : null}
    </a>
  );
}
