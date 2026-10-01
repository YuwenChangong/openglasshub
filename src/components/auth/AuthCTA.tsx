import { useMemo, useState } from "react";
import { buildLoginHref, getSafeNext } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { useBrowserAuthState } from "./useBrowserAuthState";
import { resolveLocale, type LocaleContext } from "../../lib/i18n/locale";
import { useLocale } from "../i18n/useLocale";

interface AuthCTAProps {
  next?: string;
  compact?: boolean;
  localeContext?: LocaleContext;
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

export default function AuthCTA({ next = "/", compact = false, localeContext = resolveLocale({ acceptLanguage: "zh-CN" }) }: AuthCTAProps) {
  const { messages } = useLocale(localeContext);
  const text = messages.account;
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const safeNext = useMemo(() => getSafeNext(next), [next]);
  const { status, user } = useBrowserAuthState(supabase);
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    if (!supabase) return;
    setSigningOut(true);
    await supabase.auth.signOut();
    window.location.reload();
  }

  if (status === "checking") {
    return compact ? <span style={{ color: "#8892b0" }}>{text.checkingLogin}</span> : null;
  }

  if (status !== "signed_in" || !user) {
    return compact ? (
      <div className="ogh-auth-inline">
        <a href={buildLoginHref(safeNext)} className="ogh-login-button">{messages.shell.login}</a>
        <a href={buildLoginHref(safeNext)} className="ogh-register-button">{messages.shell.signup}</a>
      </div>
    ) : (
      <div style={{ display: "grid", gap: "0.85rem", padding: "1rem 0" }}>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <a href={buildLoginHref(safeNext)} style={primaryButtonStyle}>{text.loginSignup}</a>
          <a href="/feed/" style={secondaryButtonStyle}>{text.browseFeed}</a>
        </div>
      </div>
    );
  }

  return compact ? (
    <div className="ogh-auth-inline">
      <a href="/me/" className="ogh-auth-secondary">{text.myProfile}</a>
      <a href="/me/edit/" className="ogh-auth-secondary">{text.editProfile}</a>
      <button type="button" onClick={handleSignOut} className="ogh-auth-secondary ogh-auth-button-reset" disabled={signingOut}>
        {signingOut ? messages.shell.signingOut : messages.shell.logout}
      </button>
    </div>
  ) : (
    <div style={{ display: "grid", gap: "0.85rem", padding: "1rem 0" }}>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <a href="/me/" style={secondaryButtonStyle}>{text.myProfile}</a>
        <a href="/me/edit/" style={secondaryButtonStyle}>{text.editProfile}</a>
        <a href="/feed/" style={primaryButtonStyle}>{text.enterFeed}</a>
        <a href="/posts/new/" style={secondaryButtonStyle}>{text.newPost}</a>
        <button type="button" onClick={handleSignOut} style={secondaryButtonStyle} disabled={signingOut}>
          {signingOut ? messages.shell.signingOut : messages.shell.logout}
        </button>
      </div>
    </div>
  );
}
