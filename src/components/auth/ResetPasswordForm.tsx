import { useEffect, useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { getAuthMessages, type AuthLocale } from "../../lib/auth-messages";
import { createPasswordRecoveryAdapter, type PasswordRecoveryAdapter } from "../../lib/password-recovery-adapter";
import { clearAuthCallbackUrl, hasAuthCallbackError } from "../../lib/auth-callback-url";

export default function ResetPasswordForm({ locale = "zh-CN", recoveryAdapter }: { locale?: AuthLocale; recoveryAdapter?: PasswordRecoveryAdapter }) {
  const messages = getAuthMessages(locale);
  const supabase = useMemo(() => recoveryAdapter ? null : createBrowserSupabaseClient(), [recoveryAdapter]);
  const adapter = useMemo(() => recoveryAdapter ?? (supabase ? createPasswordRecoveryAdapter(supabase) : null), [recoveryAdapter, supabase]);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!adapter) {
      clearAuthCallbackUrl();
      setError(messages.configurationUnavailable);
      return;
    }

    let active = true;
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    const stop = () => {
      window.clearTimeout(timeoutId);
      unsubscribe?.();
      unsubscribe = undefined;
    };
    const fail = () => {
      if (!active || settled) return;
      settled = true;
      stop();
      clearAuthCallbackUrl();
      setError(messages.expiredRecovery);
    };
    const succeed = async () => {
      try {
        if (!await adapter.hasSession()) { fail(); return; }
        if (!active || settled) return;
        if (!clearAuthCallbackUrl()) { fail(); return; }
        settled = true;
        stop();
        setError("");
        setReady(true);
      } catch { fail(); }
    };
    const timeoutId = window.setTimeout(fail, 2800);
    try {
      unsubscribe = adapter.onRecoverySession(() => { void succeed(); });
      const currentUrl = new URL(window.location.href);
      const providerError = hasAuthCallbackError(currentUrl);
      const code = currentUrl.searchParams.get("code");
      const flowId = currentUrl.searchParams.get("sb_flow_id") ?? undefined;
      if (providerError || currentUrl.searchParams.has("code")) {
        if (!clearAuthCallbackUrl()) { fail(); return () => { active = false; stop(); }; }
      }
      if (providerError || (currentUrl.searchParams.has("code") && !code)) {
        fail();
      } else if (code) {
        void adapter.exchangeCode(code, flowId).then(({ error: exchangeError, redirectType }) => {
          if (!active || settled) return;
          if (exchangeError || redirectType !== "recovery") { fail(); return; }
          void succeed();
        }).catch(fail);
      }
    } catch { fail(); }

    return () => {
      active = false;
      stop();
    };
  }, [adapter, messages]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!adapter) return;

    setError("");
    setMessage("");

    if (!newPassword.trim()) {
      setError(messages.resetEmpty);
      return;
    }
    if (newPassword.length < 8) {
      setError(messages.shortPassword);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(messages.resetMismatch);
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await adapter.updatePassword(newPassword);
      if (updateError) {
        throw updateError;
      }

      setMessage(messages.resetSuccess);
      window.setTimeout(() => {
        window.location.assign("/login/");
      }, 1200);
    } catch {
      setError(messages.resetFailed);
    } finally {
      setLoading(false);
    }
  }

  if (!adapter) {
    return <section className="auth-card"><div className="auth-alert auth-alert--error">{error}</div></section>;
  }

  return (
    <section className="auth-card">
      <div className="auth-card__top">
        <h2 style={{ margin: 0 }}>{messages.resetHeading}</h2>
        <p style={{ margin: 0, color: "var(--text-muted)" }}>{messages.resetIntro}</p>
      </div>

      {!ready && !error ? (
        <div className="auth-alert">{messages.checkingRecovery}</div>
      ) : ready ? (
        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            <span className="auth-label">{messages.newPassword}</span>
            <input
              className="community-input"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>
          <label>
            <span className="auth-label">{messages.confirmPassword}</span>
            <input
              className="community-input"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>
          <div className="community-cta-row">
            <button className="community-button auth-button" type="submit" disabled={loading}>
              {loading ? messages.updating : messages.updatePassword}
            </button>
            <a href="/login/" className="community-button--secondary">
              {messages.backToLogin}
            </a>
          </div>
        </form>
      ) : (
        <div className="community-cta-row"><a href="/login/" className="community-button--secondary">{messages.backToLogin}</a></div>
      )}

      <div className="auth-feedback">
        {error ? <div className="auth-alert auth-alert--error">{error}</div> : null}
        {message ? <div className="auth-alert auth-alert--success">{message}</div> : null}
      </div>
    </section>
  );
}
