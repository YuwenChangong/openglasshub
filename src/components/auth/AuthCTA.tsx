import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { buildLoginHref, getSafeNext } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";

interface AuthCTAProps {
  next?: string;
  compact?: boolean;
}

const primaryButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "0.65rem",
  padding: "0.65rem 1rem",
  background: "#7cb5ff",
  color: "#0b0e16",
  textDecoration: "none",
  fontWeight: 600,
  border: "1px solid #7cb5ff",
};

const secondaryButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  background: "transparent",
  color: "#e8edf8",
  border: "1px solid #2a2e45",
};

export default function AuthCTA({ next = "/", compact = false }: AuthCTAProps) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const safeNext = useMemo(() => getSafeNext(next), [next]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      setUser(data.user ?? null);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  async function handleSignOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    window.location.reload();
  }

  if (loading) {
    return compact ? <span style={{ color: "#8892b0" }}>检查登录状态...</span> : null;
  }

  if (!user) {
    return compact ? (
      <div className="ogh-auth-inline">
        <a href={buildLoginHref(safeNext)} className="ogh-login-button">登录</a>
        <a href={buildLoginHref(safeNext)} className="ogh-register-button">注册</a>
      </div>
    ) : (
      <div style={{ display: "grid", gap: "0.85rem", padding: "1rem 0" }}>
        <p style={{ margin: 0, color: "#8892b0" }}>
          浏览内容无需登录。想发帖、评论或参与后续互动，需要先登录。
        </p>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <a href={buildLoginHref(safeNext)} style={primaryButtonStyle}>注册 / 登录</a>
          <a href="/feed/" style={secondaryButtonStyle}>先浏览社区动态</a>
        </div>
      </div>
    );
  }

  return compact ? (
    <div className="ogh-auth-inline">
      <span className="ogh-auth-status">{user.email}</span>
      <button type="button" onClick={handleSignOut} className="ogh-auth-secondary ogh-auth-button-reset">退出</button>
    </div>
  ) : (
    <div style={{ display: "grid", gap: "0.85rem", padding: "1rem 0" }}>
      <p style={{ margin: 0, color: "#8892b0" }}>
        当前已登录：<strong style={{ color: "#e8edf8" }}>{user.email}</strong>
      </p>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <a href="/feed/" style={primaryButtonStyle}>进入社区动态</a>
        <a href="/posts/new/" style={secondaryButtonStyle}>发布帖子</a>
        <button type="button" onClick={handleSignOut} style={secondaryButtonStyle}>退出登录</button>
      </div>
    </div>
  );
}
