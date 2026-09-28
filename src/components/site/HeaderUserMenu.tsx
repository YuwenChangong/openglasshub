import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buildLoginHref, buildSignupHref, getSafeNext } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { useBrowserAuthState } from "../auth/useBrowserAuthState";
import type { User } from "@supabase/supabase-js";
import type { AuthViewState } from "../../lib/legal-consent-adapters";
import type { UserSummarySuccess } from "../../lib/user-summary";
import { buildHeaderIdentity } from "../../lib/header-identity";

type SummaryState =
  | { actorId: string | null; status: "idle" | "loading" | "error" }
  | { actorId: string; status: "ready"; data: UserSummarySuccess };

type PopoverPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  ready: boolean;
};

interface HeaderUserMenuProps {
  next?: string;
  identityAdapter?: {
    state: { viewState: AuthViewState; user: User | null };
    getAccessToken(): Promise<string | null>;
    loadSummary(token: string, signal: AbortSignal): Promise<UserSummarySuccess>;
  };
}

const DESKTOP_POPOVER_WIDTH = 320;
const MOBILE_VIEWPORT_MARGIN = 12;
const DESKTOP_VIEWPORT_MARGIN = 16;
const CLOSE_DELAY_MS = 160;

function supportsHover() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export default function HeaderUserMenu({ next = "/", identityAdapter }: HeaderUserMenuProps) {
  const supabase = useMemo(() => identityAdapter ? null : createBrowserSupabaseClient(), [identityAdapter]);
  const safeNext = useMemo(() => getSafeNext(next), [next]);
  const browserAuth = useBrowserAuthState(supabase);
  const status = identityAdapter?.state.viewState ?? browserAuth.status;
  const user = identityAdapter ? identityAdapter.state.user : browserAuth.user;
  const [summaryState, setSummaryState] = useState<SummaryState>({ actorId: null, status: "idle" });
  const [retry, setRetry] = useState<{ actorId: string; count: number } | null>(null);
  const [failedAvatar, setFailedAvatar] = useState<{ actorId: string; url: string } | null>(null);
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
  const triggerCleanupRef = useRef<(() => void) | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const actorId = status === "signed_in" ? user?.id ?? null : null;
  const retryCount = retry?.actorId === actorId ? retry.count : 0;

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!actorId || (!supabase && !identityAdapter)) {
      setSummaryState({ actorId: null, status: "idle" });
      setRetry(null);
      setFailedAvatar(null);
      setOpen(false);
      return;
    }

    const controller = new AbortController();
    const generation = ++generationRef.current;
    let active = true;
    const isCurrent = () => active && generationRef.current === generation;
    const timeout = window.setTimeout(() => {
      if (!isCurrent()) return;
      active = false;
      controller.abort();
      setSummaryState({ actorId, status: "error" });
    }, 3000);
    setSummaryState({ actorId, status: "loading" });

    async function loadSummary() {
      try {
        const accessToken = identityAdapter ? await identityAdapter.getAccessToken()
          : (await supabase!.auth.getSession()).data.session?.access_token;
        if (!isCurrent()) return;
        if (!accessToken) {
          throw new Error("SUMMARY_TOKEN_UNAVAILABLE");
        }

        const payload = identityAdapter ? await identityAdapter.loadSummary(accessToken, controller.signal)
          : await (async () => {
              const response = await fetch("/api/users/me/summary", {
                headers: { authorization: `Bearer ${accessToken}` },
                signal: controller.signal,
              });
              if (!response.ok) throw new Error("SUMMARY_UNAVAILABLE");
              return response.json() as Promise<UserSummarySuccess>;
            })();
        if (!isCurrent()) return;
        if (payload?.ok && payload.profile?.id === actorId) {
          setSummaryState({ actorId, status: "ready", data: payload });
        } else {
          setSummaryState({ actorId, status: "error" });
        }
      } catch {
        if (isCurrent()) setSummaryState({ actorId, status: "error" });
      } finally {
        if (isCurrent()) window.clearTimeout(timeout);
      }
    }

    void loadSummary();
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
      generationRef.current += 1;
    };
  }, [actorId, supabase, identityAdapter, retryCount]);

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

  const attachTriggerRef = useCallback((node: HTMLButtonElement | null) => {
    triggerCleanupRef.current?.();
    triggerCleanupRef.current = null;
    triggerRef.current = node;

    if (!node) return;

    const handleTriggerClick = () => {
      clearCloseTimer();
      setOpen(true);
    };

    node.addEventListener("click", handleTriggerClick);
    triggerCleanupRef.current = () => {
      node.removeEventListener("click", handleTriggerClick);
    };
  }, [clearCloseTimer]);

  useEffect(() => {
    return () => {
      triggerCleanupRef.current?.();
      triggerCleanupRef.current = null;
    };
  }, []);

  async function handleSignOut() {
    if (!supabase) return;
    setSigningOut(true);
    await supabase.auth.signOut();
    window.location.reload();
  }

  if (status === "checking") {
    return (
      <div className="ogh-auth-inline">
        <a href={buildLoginHref(safeNext)} className="ogh-login-button">
          登录
        </a>
        <a href={buildSignupHref(safeNext)} className="ogh-register-button">
          注册
        </a>
      </div>
    );
  }

  if (status !== "signed_in" || !user) {
    return (
      <div className="ogh-auth-inline">
        <a href={buildLoginHref(safeNext)} className="ogh-login-button">
          登录
        </a>
        <a href={buildSignupHref(safeNext)} className="ogh-register-button">
          注册
        </a>
      </div>
    );
  }

  const currentSummaryState = summaryState.actorId === actorId ? summaryState : null;
  const summary = currentSummaryState?.status === "ready" ? currentSummaryState.data : null;
  const identity = buildHeaderIdentity({ user, profile: summary?.profile ?? null, locale: "zh-CN" });
  const avatarUrl = failedAvatar?.actorId === actorId && failedAvatar.url === identity.avatarUrl ? null : identity.avatarUrl;
  const profileHref = summary?.profile.profile_href ?? `/users/${encodeURIComponent(user.id)}/`;
  const postCount = summary?.stats.post_count;
  const receivedLikeCount = summary?.stats.received_like_count;

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
              <img src={avatarUrl} alt="" className="header-user-menu__profile-avatar" decoding="async" onError={() => setFailedAvatar({ actorId: user.id, url: avatarUrl })} />
            ) : (
              <span
                className="header-user-menu__profile-avatar header-user-menu__profile-avatar--fallback"
                aria-hidden="true"
              >
                {identity.initial}
              </span>
            )}
            <div className="header-user-menu__identity">
              <div className="header-user-menu__identity-top">
                <strong>{identity.label}</strong>
              </div>
            </div>
          </div>

          <div className="header-user-menu__stats">
            <div className="header-user-menu__stat">
              <span>发帖</span>
              <strong>{postCount === null || postCount === undefined ? "不可用" : postCount}</strong>
            </div>
            <div className="header-user-menu__stat">
              <span>获赞</span>
              <strong>{receivedLikeCount === null || receivedLikeCount === undefined ? "不可用" : receivedLikeCount}</strong>
            </div>
          </div>

          <div className="header-user-menu__actions">
            {currentSummaryState?.status === "error" && retryCount === 0 ? (
              <button type="button" className="header-user-menu__action header-user-menu__action--button" onClick={() => setRetry({ actorId: user.id, count: 1 })}>
                重试
              </button>
            ) : null}
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
        ref={attachTriggerRef}
        type="button"
        className={`header-user-menu__trigger${open ? " is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="header-user-menu"
        aria-label="打开账户菜单"
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="header-user-menu__avatar" decoding="async" onError={() => setFailedAvatar({ actorId: user.id, url: avatarUrl })} />
        ) : (
          <span
            data-testid="header-identity-initial"
            className="header-user-menu__avatar header-user-menu__avatar--fallback"
            aria-hidden="true"
          >
            {identity.initial}
          </span>
        )}
        <span className="header-user-menu__trigger-copy">
          <strong data-testid="header-identity-label">{identity.label}</strong>
        </span>
        <span className="header-user-menu__chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {popover}
    </div>
  );
}
