import { useEffect, useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { getAuthMessages, type AuthLocale } from "../../lib/auth-messages";

export default function ResetPasswordForm({ locale = "zh-CN" }: { locale?: AuthLocale }) {
  const messages = getAuthMessages(locale);
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase) {
      setError(messages.configurationUnavailable);
      return;
    }

    let mounted = true;
    let timeoutId: number | undefined;

    async function ensureRecoverySession() {
      const currentUrl = new URL(window.location.href);
      const code = currentUrl.searchParams.get("code");
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          throw exchangeError;
        }
      }

      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      if (data.session) {
        setReady(true);
      }
    }

    async function boot() {
      try {
        await ensureRecoverySession();

        const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
          if (!mounted) return;
          if (session && (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
            setReady(true);
          }
        });

        timeoutId = window.setTimeout(() => {
          if (!mounted) return;
          if (!ready) {
            setError(messages.expiredRecovery);
          }
        }, 2800);

        return () => {
          listener.subscription.unsubscribe();
        };
      } catch {
        if (!mounted) return;
        setError(messages.expiredRecovery);
      }
    }

    let unsubscribe: (() => void) | undefined;
    boot().then((cleanup) => {
      unsubscribe = cleanup;
    });

    return () => {
      mounted = false;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      unsubscribe?.();
    };
  }, [supabase, ready]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) return;

    setError("");
    setMessage("");

    const trimmedPassword = newPassword.trim();
    const trimmedConfirm = confirmPassword.trim();

    if (!trimmedPassword) {
      setError(messages.resetEmpty);
      return;
    }
    if (trimmedPassword.length < 8) {
      setError(messages.shortPassword);
      return;
    }
    if (trimmedPassword !== trimmedConfirm) {
      setError(messages.resetMismatch);
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: trimmedPassword });
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

  if (!supabase) {
    return <section className="auth-card"><div className="auth-alert auth-alert--error">{error}</div></section>;
  }

  return (
    <section className="auth-card">
      <div className="auth-card__top">
        <h2 style={{ margin: 0 }}>{messages.resetHeading}</h2>
        <p style={{ margin: 0, color: "var(--text-muted)" }}>{messages.resetIntro}</p>
      </div>

      {!ready ? (
        <div className="auth-alert">{messages.checkingRecovery}</div>
      ) : (
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
      )}

      <div className="auth-feedback">
        {error ? <div className="auth-alert auth-alert--error">{error}</div> : null}
        {message ? <div className="auth-alert auth-alert--success">{message}</div> : null}
      </div>
    </section>
  );
}
