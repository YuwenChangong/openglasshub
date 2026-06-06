import { useEffect, useMemo, useRef, useState } from "react";
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

interface HeaderUserMenuProps {
  next?: string;
}

function shortenUserId(value?: string | null) {
  if (!value) return "用户";
  return value.length <= 12 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function getInitial(value: string) {
  return (value.trim().charAt(0) || "U").toUpperCase();
}

export default function HeaderUserMenu({ next = "/" }: HeaderUserMenuProps) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const safeNext = useMemo(() => getSafeNext(next), [next]);
  const { status, user } = useBrowserAuthState(supabase);
  const [summaryState, setSummaryState] = useState<SummaryState>({ status: "idle" });
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (rootRef.current && target && !rootRef.current.contains(target)) {
        setOpen(false);
      }
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
  const displayName =
    summary?.profile.display_name?.trim() ||
    summary?.profile.username?.trim() ||
    (summaryState.status === "ready" ? shortenUserId(summary?.profile.id ?? user.id) : "我的账号");
  const avatarUrl = summary?.profile.avatar_resolved_url ?? null;
  const profileHref = summary?.profile.profile_href ?? `/users/${encodeURIComponent(user.id)}/`;
  const username = summary?.profile.username?.trim() || null;
  const identityId = summary?.profile.id ?? user.id;
  const postCount = summary?.stats.post_count ?? 0;
  const receivedLikeCount = Math.max(0, summary?.stats.received_like_count ?? 0);

  return (
    <div className="header-user-menu" ref={rootRef}>
      <button
        type="button"
        className={`header-user-menu__trigger${open ? " is-open" : ""}`}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="打开账户菜单"
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="header-user-menu__avatar" />
        ) : (
          <span className="header-user-menu__avatar header-user-menu__avatar--fallback" aria-hidden="true">
            {getInitial(displayName)}
          </span>
        )}
        <span
          className={`header-user-menu__trigger-copy${
            summaryState.status !== "ready" ? " header-user-menu__trigger-copy--loading" : ""
          }`}
        >
          <strong>{displayName}</strong>
        </span>
        <span className="header-user-menu__chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div className="header-user-menu__popover" role="menu" aria-label="账户菜单">
          <div className="header-user-menu__profile">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="header-user-menu__profile-avatar" />
            ) : (
              <span
                className="header-user-menu__profile-avatar header-user-menu__profile-avatar--fallback"
                aria-hidden="true"
              >
                {getInitial(displayName)}
              </span>
            )}
            <div className="header-user-menu__identity">
              <div className="header-user-menu__identity-top">
                <strong>{displayName}</strong>
              </div>
              {username ? <span>@{username}</span> : null}
              <span className="header-user-menu__identity-id">ID: {identityId}</span>
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
        </div>
      ) : null}
    </div>
  );
}
