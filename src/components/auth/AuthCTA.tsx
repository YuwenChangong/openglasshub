import { useMemo, useState } from "react";
import { buildLoginHref, getSafeNext } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { useBrowserAuthState } from "./useBrowserAuthState";

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
  const { status, user } = useBrowserAuthState(supabase);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);

  async function handleSignOut() {
    if (!supabase || signingOut) return;
    setSigningOut(true);
    setSignOutError(false);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) throw new Error("missing session");
      const response = await fetch("/api/auth/logout", {
        method: "POST", headers: { authorization: `Bearer ${data.session.access_token}` },
      });
      if (!response.ok) throw new Error("revocation failed");
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      window.location.reload();
    } catch {
      setSignOutError(true);
      setSigningOut(false);
    }
  }

  if (status === "checking") {
    return compact ? <span style={{ color: "#8892b0" }}>检查登录状态...</span> : null;
  }

  if (status !== "signed_in" || !user) {
    return compact ? (
      <div className="ogh-auth-inline">
        <a href={buildLoginHref(safeNext)} className="ogh-login-button">登录</a>
        <a href={buildLoginHref(safeNext)} className="ogh-register-button">注册</a>
      </div>
    ) : (
      <div style={{ display: "grid", gap: "0.85rem", padding: "1rem 0" }}>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <a href={buildLoginHref(safeNext)} style={primaryButtonStyle}>注册 / 登录</a>
          <a href="/feed/" style={secondaryButtonStyle}>浏览动态</a>
        </div>
      </div>
    );
  }

  return compact ? (
    <div className="ogh-auth-inline">
      <a href="/me/" className="ogh-auth-secondary">我的主页</a>
      <a href="/me/edit/" className="ogh-auth-secondary">编辑资料</a>
      <button type="button" onClick={handleSignOut} className="ogh-auth-secondary ogh-auth-button-reset" disabled={signingOut}>
        {signingOut ? "退出中..." : "退出"}
      </button>
      {signOutError ? <span role="alert">退出失败，请稍后重试。</span> : null}
    </div>
  ) : (
    <div style={{ display: "grid", gap: "0.85rem", padding: "1rem 0" }}>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <a href="/me/" style={secondaryButtonStyle}>我的主页</a>
        <a href="/me/edit/" style={secondaryButtonStyle}>编辑资料</a>
        <a href="/feed/" style={primaryButtonStyle}>进入社区动态</a>
        <a href="/posts/new/" style={secondaryButtonStyle}>去发帖</a>
        <button type="button" onClick={handleSignOut} style={secondaryButtonStyle} disabled={signingOut}>
          {signingOut ? "退出中..." : "退出登录"}
        </button>
        {signOutError ? <span role="alert">退出失败，请稍后重试。</span> : null}
      </div>
    </div>
  );
}
