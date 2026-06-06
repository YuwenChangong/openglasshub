import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { useBrowserAuthState } from "../auth/useBrowserAuthState";
import type { NotificationItem } from "../../lib/notifications";

type NotificationsPayload = {
  ok: true;
  unread_count: number;
  notifications: NotificationItem[];
};

type NotificationsState =
  | { status: "idle" | "loading" }
  | { status: "ready"; data: NotificationsPayload }
  | { status: "error" };

type PopoverPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  ready: boolean;
};

const DESKTOP_POPOVER_WIDTH = 360;
const MOBILE_VIEWPORT_MARGIN = 12;
const DESKTOP_VIEWPORT_MARGIN = 16;

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
function clampUnreadCount(value: number): string {
  if (value > 99) return "99+";
  return String(Math.max(0, value));
}

function getInitial(label?: string | null): string {
  return (label?.trim().charAt(0) || "U").toUpperCase();
}

export default function HeaderNotifications() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const { status, user } = useBrowserAuthState(supabase);
  const [notificationsState, setNotificationsState] = useState<NotificationsState>({ status: "idle" });
  const [open, setOpen] = useState(false);
  const [updatingAll, setUpdatingAll] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const [position, setPosition] = useState<PopoverPosition>({
    top: 0,
    left: 0,
    width: DESKTOP_POPOVER_WIDTH,
    maxHeight: 520,
    ready: false,
  });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  const loadNotifications = useCallback(async () => {
    if (!supabase || status !== "signed_in" || !user) {
      setNotificationsState({ status: "idle" });
      return;
    }

    setNotificationsState((current) => (current.status === "ready" ? current : { status: "loading" }));

    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) {
        setNotificationsState({ status: "error" });
        return;
      }

      const response = await fetch("/api/users/me/notifications?limit=8", {
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        setNotificationsState({ status: "error" });
        return;
      }

      const payload = (await response.json().catch(() => null)) as NotificationsPayload | null;
      if (payload?.ok) {
        setNotificationsState({ status: "ready", data: payload });
      } else {
        setNotificationsState({ status: "error" });
      }
    } catch {
      setNotificationsState({ status: "error" });
    }
  }, [status, supabase, user]);

  useEffect(() => {
    if (status !== "signed_in" || !user) {
      setOpen(false);
      setNotificationsState({ status: "idle" });
      return;
    }

    void loadNotifications();
  }, [loadNotifications, status, user]);

  const updatePopoverPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === "undefined") return;

    const triggerRect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const viewportMargin = viewportWidth <= 720 ? MOBILE_VIEWPORT_MARGIN : DESKTOP_VIEWPORT_MARGIN;
    const width = Math.min(DESKTOP_POPOVER_WIDTH, viewportWidth - viewportMargin * 2);
    const maxHeight = Math.min(520, Math.max(240, viewportHeight - 96));
    const popoverHeight = popoverRef.current?.offsetHeight ?? 380;
    const top = Math.max(
      viewportMargin,
      Math.min(triggerRect.bottom + 10, viewportHeight - Math.min(popoverHeight, maxHeight) - viewportMargin),
    );
    const left = Math.max(
      viewportMargin,
      Math.min(triggerRect.right - width, viewportWidth - width - viewportMargin),
    );

    setPosition({
      top,
      left,
      width,
      maxHeight,
      ready: true,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open || !portalReady) return;

    updatePopoverPosition();
    const rafId = window.requestAnimationFrame(() => updatePopoverPosition());
    const handleViewportChange = () => updatePopoverPosition();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, portalReady, updatePopoverPosition]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const unreadCount = notificationsState.status === "ready" ? notificationsState.data.unread_count : 0;
  const notifications = notificationsState.status === "ready" ? notificationsState.data.notifications : [];

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

      setNotificationsState((current) => {
        if (current.status !== "ready") return current;
        const nextUnread = Math.max(
          0,
          current.data.unread_count -
            (current.data.notifications.some((item) => item.id === notificationId && item.read_at === null) ? 1 : 0),
        );
        return {
          status: "ready",
          data: {
            unread_count: nextUnread,
            notifications: current.data.notifications.map((item) =>
              item.id === notificationId ? { ...item, read_at: new Date().toISOString() } : item,
            ),
          },
        };
      });
    } catch {
      // keep navigation working even if read update fails
    }
  }, [supabase]);

  const handleOpenNotification = useCallback(async (notification: NotificationItem) => {
    await markRead(notification.id);
    window.location.assign(notification.href);
  }, [markRead]);

  const handleMarkAllRead = useCallback(async () => {
    if (updatingAll || !supabase) return;
    setUpdatingAll(true);
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

      setNotificationsState((current) =>
        current.status === "ready"
          ? {
              status: "ready",
              data: {
                unread_count: 0,
                notifications: current.data.notifications.map((item) => ({
                  ...item,
                  read_at: item.read_at ?? new Date().toISOString(),
                })),
              },
            }
          : current,
      );
    } finally {
      setUpdatingAll(false);
    }
  }, [supabase, updatingAll]);

  if (status === "checking" || status !== "signed_in" || !user) {
    return null;
  }

  const popover = open && portalReady
    ? createPortal(
        <div
          ref={popoverRef}
          className={`header-notifications__popover${position.ready ? " is-ready" : ""}`}
          style={{
            position: "fixed",
            top: `${position.top}px`,
            left: `${position.left}px`,
            width: `${position.width}px`,
            maxHeight: `${position.maxHeight}px`,
            zIndex: 10045,
          }}
        >
          <div className="header-notifications__head">
            <strong>通知</strong>
            <button
              type="button"
              className="header-notifications__mark-all"
              onClick={() => void handleMarkAllRead()}
              disabled={updatingAll || unreadCount < 1}
            >
              {updatingAll ? "处理中..." : "全部已读"}
            </button>
          </div>

          <div className="header-notifications__list">
            {notificationsState.status === "loading" ? (
              <div className="header-notifications__empty">加载通知中...</div>
            ) : notificationsState.status === "error" ? (
              <div className="header-notifications__empty">通知加载失败</div>
            ) : notifications.length === 0 ? (
              <div className="header-notifications__empty">暂无通知</div>
            ) : (
              notifications.map((notification) => {
                const actorLabel =
                  notification.actor.display_name || notification.actor.username || "有人";
                const unread = notification.read_at === null;

                return (
                  <button
                    key={notification.id}
                    type="button"
                    className={`header-notifications__item${unread ? " is-unread" : ""}`}
                    onClick={() => void handleOpenNotification(notification)}
                  >
                    {notification.actor.avatar_resolved_url ? (
                      <img src={notification.actor.avatar_resolved_url} alt="" className="header-notifications__avatar" />
                    ) : (
                      <span className="header-notifications__avatar header-notifications__avatar--fallback" aria-hidden="true">
                        {getInitial(actorLabel)}
                      </span>
                    )}
                    <span className="header-notifications__copy">
                      <strong>{notification.message}</strong>
                      {notification.preview ? <span>{notification.preview}</span> : null}
                      <small>{formatRelativeTime(notification.created_at)}</small>
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div className="header-notifications__foot">
            <a href="/notifications/" className="header-notifications__view-all" onClick={() => setOpen(false)}>
              查看全部
            </a>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="header-notifications">
      <button
        ref={triggerRef}
        type="button"
        className={`header-notifications__trigger${open ? " is-open" : ""}`}
        aria-label="打开通知中心"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          const nextOpen = !open;
          setOpen(nextOpen);
          if (!open) {
            void loadNotifications();
          }
        }}
      >
        <span className="header-notifications__icon" aria-hidden="true">🔔</span>
        {unreadCount > 0 ? (
          <span className="header-notifications__badge">
            {clampUnreadCount(unreadCount)}
          </span>
        ) : null}
      </button>
      {popover}
    </div>
  );
}
