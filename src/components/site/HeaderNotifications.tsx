import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createBrowserSupabaseClient, syncBrowserRealtimeAuth } from "../../lib/supabase-browser";
import { useBrowserAuthState } from "../auth/useBrowserAuthState";
import {
  getNotificationVisualLabel,
  isSystemNotificationType,
  sortNotificationsByLatestEvent,
  type NotificationItem,
} from "../../lib/notifications";

type NotificationsPayload = {
  ok: true;
  unread_count: number;
  notifications: NotificationItem[];
};

type NotificationsState =
  | { status: "idle" | "loading" }
  | { status: "ready"; unreadCount: number; unreadItems: NotificationItem[] }
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
const CLOSE_DELAY_MS = 160;

function clampUnreadCount(value: number): string {
  if (value > 99) return "99+";
  return String(Math.max(0, value));
}

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

function supportsHover() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function NotificationBellIcon() {
  return (
    <svg
      className="header-notifications__bell-svg"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      preserveAspectRatio="xMidYMid meet"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 4.75a4.25 4.25 0 0 0-4.25 4.25v2.08c0 .92-.24 1.82-.7 2.62l-.92 1.62c-.14.24-.02.55.25.65.84.32 2.45.68 5.62.68 3.17 0 4.78-.36 5.62-.68.27-.1.39-.41.25-.65l-.92-1.62a5.27 5.27 0 0 1-.7-2.62V9A4.25 4.25 0 0 0 12 4.75Z"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d="M10.2 18.15a1.9 1.9 0 0 0 3.6 0"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function HeaderNotifications() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const { status, user } = useBrowserAuthState(supabase);
  const [notificationsState, setNotificationsState] = useState<NotificationsState>({ status: "idle" });
  const [open, setOpen] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const [position, setPosition] = useState<PopoverPosition>({
    top: 0,
    left: 0,
    width: DESKTOP_POPOVER_WIDTH,
    maxHeight: 520,
    ready: false,
  });
  const triggerRef = useRef<HTMLAnchorElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const applyUnreadState = useCallback((payload: NotificationsPayload) => {
    const unreadItems = sortNotificationsByLatestEvent(
      payload.notifications.filter((item) => item.read_at === null),
    );
    setNotificationsState({
      status: "ready",
      unreadCount: Math.max(0, payload.unread_count),
      unreadItems,
    });
  }, []);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, CLOSE_DELAY_MS);
  }, [clearCloseTimer]);

  const loadUnreadMenu = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
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

      const response = await fetch("/api/users/me/notifications?limit=8&unread_only=1", {
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
        applyUnreadState(payload);
      } else if (!silent) {
        setNotificationsState({ status: "error" });
      }
    } catch {
      if (!silent) {
        setNotificationsState({ status: "error" });
      }
    }
  }, [applyUnreadState, status, supabase, user]);

  useEffect(() => {
    if (status !== "signed_in" || !user) {
      setOpen(false);
      setNotificationsState({ status: "idle" });
      return;
    }

    void loadUnreadMenu();
  }, [loadUnreadMenu, status, user]);

  useEffect(() => {
    const handleReadEvent = () => {
      setNotificationsState((current) =>
        current.status === "ready"
          ? { status: "ready", unreadCount: 0, unreadItems: [] }
          : current,
      );
    };

    window.addEventListener("openglass:notifications-read", handleReadEvent);
    return () => {
      window.removeEventListener("openglass:notifications-read", handleReadEvent);
    };
  }, []);

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
            void loadUnreadMenu({ silent: true });
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
  }, [loadUnreadMenu, status, supabase, user]);

  const updatePopoverPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === "undefined") return;

    const triggerRect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const viewportMargin = viewportWidth <= 720 ? MOBILE_VIEWPORT_MARGIN : DESKTOP_VIEWPORT_MARGIN;
    const width = Math.min(DESKTOP_POPOVER_WIDTH, viewportWidth - viewportMargin * 2);
    const maxHeight = Math.min(520, Math.max(220, viewportHeight - 140));
    const popoverHeight = popoverRef.current?.offsetHeight ?? 320;
    const top = Math.max(
      viewportMargin,
      Math.min(triggerRect.bottom + 10, viewportHeight - Math.min(popoverHeight, maxHeight) - viewportMargin),
    );
    const left = Math.max(
      viewportMargin,
      Math.min(triggerRect.right - width, viewportWidth - width - viewportMargin),
    );

    setPosition({ top, left, width, maxHeight, ready: true });
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

  useEffect(() => {
    return () => clearCloseTimer();
  }, [clearCloseTimer]);

  const markAllRead = useCallback(async () => {
    if (markingAll || !supabase) return;
    setMarkingAll(true);

    setNotificationsState((current) =>
      current.status === "ready" ? { status: "ready", unreadCount: 0, unreadItems: [] } : current,
    );
    window.dispatchEvent(new CustomEvent("openglass:notifications-read"));

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

      if (!response.ok) {
        void loadUnreadMenu({ silent: true });
      }
    } finally {
      setMarkingAll(false);
    }
  }, [loadUnreadMenu, markingAll, supabase]);

  const markSingleReadAndNavigate = useCallback(async (notification: NotificationItem) => {
    setNotificationsState((current) => {
      if (current.status !== "ready") return current;
      const nextItems = current.unreadItems.filter((item) => item.id !== notification.id);
      return {
        status: "ready",
        unreadCount: Math.max(0, current.unreadCount - 1),
        unreadItems: nextItems,
      };
    });

    try {
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (accessToken) {
          await fetch("/api/users/me/notifications", {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              action: "mark_read",
              notification_id: notification.id,
            }),
          });
        }
      }
    } finally {
      window.location.assign(notification.href);
    }
  }, [supabase]);

  if (status === "checking" || status !== "signed_in" || !user) {
    return null;
  }

  const unreadCount = notificationsState.status === "ready" ? notificationsState.unreadCount : 0;
  const unreadItems = notificationsState.status === "ready" ? notificationsState.unreadItems : [];

  const popover = open && portalReady
    ? createPortal(
        <div
          ref={popoverRef}
          className={`header-notifications__popover header-notifications__popover--fixed${position.ready ? " is-ready" : ""}`}
          style={{
            position: "fixed",
            top: `${position.top}px`,
            left: `${position.left}px`,
            width: `${position.width}px`,
            maxHeight: `${position.maxHeight}px`,
            zIndex: 10045,
          }}
          onMouseEnter={() => {
            if (supportsHover()) clearCloseTimer();
          }}
          onMouseLeave={() => {
            if (supportsHover()) scheduleClose();
          }}
        >
          <div className="header-notifications__head">
            <strong>通知</strong>
            {unreadCount > 0 ? (
              <button
                type="button"
                className="header-notifications__mark-all"
                onClick={() => void markAllRead()}
                disabled={markingAll}
              >
                {markingAll ? "处理中..." : "全部已读"}
              </button>
            ) : null}
          </div>

          <div className="header-notifications__list">
            {notificationsState.status === "loading" ? (
              <div className="header-notifications__empty">加载通知中...</div>
            ) : notificationsState.status === "error" ? (
              <div className="header-notifications__empty">通知加载失败</div>
            ) : unreadItems.length === 0 ? (
              <div className="header-notifications__empty">暂无未读通知</div>
            ) : (
              unreadItems.map((notification) => {
                const actorLabel = getNotificationVisualLabel(notification.type, notification.actor);
                const systemNotification = isSystemNotificationType(notification.type);
                return (
                  <button
                    key={notification.id}
                    type="button"
                    className="header-notifications__item is-unread"
                    onClick={() => void markSingleReadAndNavigate(notification)}
                  >
                    {notification.actor.avatar_resolved_url && !systemNotification ? (
                      <img src={notification.actor.avatar_resolved_url} alt="" className="header-notifications__avatar" />
                    ) : (
                      <span className="header-notifications__avatar header-notifications__avatar--fallback" aria-hidden="true">
                        {systemNotification ? "系" : getInitial(actorLabel)}
                      </span>
                    )}
                    <span className="header-notifications__copy">
                      <strong>{notification.message}</strong>
                      {notification.preview ? <span>{notification.preview}</span> : null}
                      <small>{formatRelativeTime(notification.last_event_at || notification.created_at)}</small>
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div className="header-notifications__foot">
            <a
              href="/notifications/"
              className="header-notifications__view-all"
              onClick={(event) => {
                event.preventDefault();
                window.location.assign("/notifications/");
              }}
            >
              查看全部通知
            </a>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div
      className="header-notifications"
      onMouseEnter={() => {
        if (supportsHover()) {
          clearCloseTimer();
          setOpen(true);
          void loadUnreadMenu({ silent: true });
        }
      }}
      onMouseLeave={() => {
        if (supportsHover()) {
          scheduleClose();
        }
      }}
    >
      <a
        ref={triggerRef}
        href="/notifications/"
        className={`header-notifications__trigger${open ? " is-open" : ""}`}
        aria-label={unreadCount > 0 ? `通知，${clampUnreadCount(unreadCount)} 条未读` : "通知"}
        title="通知"
        onFocus={() => {
          clearCloseTimer();
          setOpen(true);
          void loadUnreadMenu({ silent: true });
        }}
      >
        <span className="header-notifications__icon" aria-hidden="true">
          <NotificationBellIcon />
        </span>
        {unreadCount > 0 ? <span className="header-notifications__badge">{clampUnreadCount(unreadCount)}</span> : null}
      </a>
      {popover}
    </div>
  );
}
