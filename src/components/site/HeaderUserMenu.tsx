import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buildLoginHref, getSafeNext } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { useBrowserAuthState } from "../auth/useBrowserAuthState";

type HeaderSummary = {
  ok: true;
  profile: {
    id: string;
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
    role: string | null;
    profile_href: string | null;
    avatar_resolved_url: string | null;
  };
  stats: {
    post_count: number;
    received_like_count: number;
  };
};

type SummaryState =
  | { status: "idle" | "loading" }
  | { status: "ready"; data: HeaderSummary }
  | { status: "error" };

type PopoverPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  ready: boolean;
};

interface HeaderUserMenuProps {
  next?: string;
}

const DESKTOP_POPOVER_WIDTH = 320;
const MOBILE_VIEWPORT_MARGIN = 12;
const DESKTOP_VIEWPORT_MARGIN = 16;
const CLOSE_DELAY_MS = 160;

function shortenUserId(value?: string | null) {
  if (!value) return "用户";
  return value.length <= 12 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function getInitial(value: string) {
  return (value.trim().charAt(0) || "U").toUpperCase();
}

function supportsHover() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export default function HeaderUserMenu({ next = "/" }: HeaderUserMenuProps) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const safeNext = useMemo(() => getSafeNext(next), [next]);
  const { status, user } = useBrowserAuthState(supabase);
  const [summaryState, setSummaryState] = useState<SummaryState>({ status: "idle" });
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
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
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (status !== "signed_in" || !user || !supabase) {
      setSummaryState({ status: "idle" });
      setOpen(false);
      return;
    }

    let cancelled = false;
    async function loadSummary() {
      setSummaryState({ status: "loading" });
      try {
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (!accessToken) {
          if (!cancelled) setSummaryState({ status: "error" });
          return;
        }

        const response = await fetch("/api/users/me/summary", {
          headers: {
            authorization: `Bearer ${accessToken}`,
          },
        });

        if (!response.ok) {
          if (!cancelled) setSummaryState({ status: "error" });
          return;
        }

        const payload = (await response.json().catch(() => null)) as HeaderSummary | null;
        if (!cancelled && payload?.ok) {
          setSummaryState({ status: "ready", data: payload });
        } else if (!cancelled) {
          setSummaryState({ status: "error" });
        }
      } catch {
        if (!cancelled) setSummaryState({ status: "error" });
      }
    }

    void loadSummary();
    return () => {
      cancelled = true;
    };
  }, [status, supabase, user]);

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

  const updatePopoverPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === "undefined") return;

    const triggerRect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const viewportMargin = viewportWidth <= 720 ? MOBILE_VIEWPORT_MARGIN : DESKTOP_VIEWPORT_MARGIN;
    const width = Math.min(DESKTOP_POPOVER_WIDTH, viewportWidth - viewportMargin * 2);
    const maxHeight = Math.min(520, Math.max(240, viewportHeight - 96));

    const popoverHeight = popoverRef.current?.offsetHeight ?? 360;
    const unclampedTop = triggerRect.bottom + 10;
    const top = Math.max(
      viewportMargin,
      Math.min(unclampedTop, viewportHeight - Math.min(popoverHeight, maxHeight) - viewportMargin),
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
    const rafId = window.requestAnimationFrame(() => {
      updatePopoverPosition();
    });

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
    return () => {
      clearCloseTimer();
    };
  }, [clearCloseTimer]);

  async function handleSignOut() {
    if (!supabase) return;
    setSigningOut(true);
    await supabase.auth.signOut();
    window.location.reload();
  }

  if (status === "checking") {
    return <span className="header-user-menu__status">检查登录状态...</span>;
  }

  if (status !== "signed_in" || !user) {
    return (
      <div className="ogh-auth-inline">
        <a href={buildLoginHref(safeNext)} className="ogh-login-button">
          登录
        </a>
        <a href={buildLoginHref(safeNext)} className="ogh-register-button">
          注册
        </a>
      </div>
    );
  }

  const summary = summaryState.status === "ready" ? summaryState.data : null;
  const summaryReady = summaryState.status === "ready";
  const displayName = summaryReady
    ? summary?.profile.display_name?.trim() || summary?.profile.username?.trim() || shortenUserId(summary?.profile.id ?? user.id)
    : "";
  const avatarUrl = summary?.profile.avatar_resolved_url ?? null;
  const profileHref = summary?.profile.profile_href ?? `/users/${encodeURIComponent(user.id)}/`;
  const identityId = summary?.profile.id ?? user.id;
  const postCount = summary?.stats.post_count ?? 0;
  const receivedLikeCount = Math.max(0, summary?.stats.received_like_count ?? 0);

  const popover = open && portalReady
    ? createPortal(
        <div
          id="header-user-menu"
          ref={popoverRef}
          className={`header-user-menu__popover header-user-menu__popover--fixed${position.ready ? " is-ready" : ""}`}
          role="menu"
          aria-label="账户菜单"
          style={{
            position: "fixed",
            top: `${position.top}px`,
            left: `${position.left}px`,
            width: `${position.width}px`,
            maxHeight: `${position.maxHeight}px`,
            zIndex: 10050,
          }}
          onMouseEnter={() => {
            if (supportsHover()) clearCloseTimer();
          }}
          onMouseLeave={() => {
            if (supportsHover()) scheduleClose();
          }}
        >
          <div className="header-user-menu__profile">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="header-user-menu__profile-avatar" decoding="async" />
            ) : (
              <span
                className={`header-user-menu__profile-avatar header-user-menu__profile-avatar--fallback${
                  !summaryReady ? " header-user-menu__avatar--skeleton" : ""
                }`}
                aria-hidden="true"
              >
                {summaryReady ? getInitial(displayName) : ""}
              </span>
            )}
            <div className="header-user-menu__identity">
              <div className="header-user-menu__identity-top">
                <strong>{summaryReady ? displayName : ""}</strong>
              </div>
              {summaryReady ? <span className="header-user-menu__identity-id">ID: {identityId}</span> : null}
            </div>
          </div>

          <div className="header-user-menu__stats">
            <div className="header-user-menu__stat">
              <span>发帖</span>
              <strong>{postCount}</strong>
            </div>
            <div className="header-user-menu__stat">
              <span>获赞</span>
              <strong>{receivedLikeCount}</strong>
            </div>
          </div>

          <div className="header-user-menu__actions">
            <a href={profileHref} className="header-user-menu__action" role="menuitem" onClick={() => setOpen(false)}>
              个人主页
            </a>
            <a href="/me/edit/" className="header-user-menu__action" role="menuitem" onClick={() => setOpen(false)}>
              编辑资料
            </a>
            <button
              type="button"
              className="header-user-menu__action header-user-menu__action--button"
              role="menuitem"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
            >
              {signingOut ? "退出中..." : "退出登录"}
            </button>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div
      className="header-user-menu"
      onMouseEnter={() => {
        if (supportsHover()) {
          clearCloseTimer();
          setOpen(true);
        }
      }}
      onMouseLeave={() => {
        if (supportsHover()) {
          scheduleClose();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`header-user-menu__trigger${open ? " is-open" : ""}${!summaryReady ? " is-loading" : ""}`}
        onClick={() => {
          clearCloseTimer();
          setOpen((current) => !current);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="header-user-menu"
        aria-label="打开账户菜单"
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="header-user-menu__avatar" decoding="async" />
        ) : (
          <span
            className={`header-user-menu__avatar header-user-menu__avatar--fallback${
              !summaryReady ? " header-user-menu__avatar--skeleton" : ""
            }`}
            aria-hidden="true"
          >
            {summaryReady ? getInitial(displayName) : ""}
          </span>
        )}
        <span
          className={`header-user-menu__trigger-copy${
            !summaryReady ? " header-user-menu__trigger-copy--loading" : ""
          }`}
        >
          <strong>{summaryReady ? displayName : ""}</strong>
        </span>
        <span className="header-user-menu__chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {popover}
    </div>
  );
}
