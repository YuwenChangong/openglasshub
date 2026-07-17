import { useEffect, useMemo, useState } from "react";
import { getSafeNext } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { getLegalConsentStatus } from "../../lib/legal-consent-client";
import { browserNavigationAdapter, type LegalConsentAdapter, type LegalConsentAuthAdapter, type LegalConsentNavigationAdapter } from "../../lib/legal-consent-adapters";

interface AuthCallbackProps {
  next?: string;
  authAdapter?: LegalConsentAuthAdapter;
  consentAdapter?: LegalConsentAdapter;
  navigationAdapter?: LegalConsentNavigationAdapter;
}

function mapCallbackError(errorMessage: string): string {
  if (/Auth session missing/i.test(errorMessage)) return "当前还没有建立登录会话，请稍候或重新打开确认链接。";
  return errorMessage;
}

export default function AuthCallback({ next, authAdapter, consentAdapter, navigationAdapter }: AuthCallbackProps) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const navigation = useMemo(() => navigationAdapter ?? browserNavigationAdapter(), [navigationAdapter]);
  const safeNext = useMemo(() => {
    if (next) return getSafeNext(next);
    if (typeof window === "undefined") return "/";
    return getSafeNext(new URLSearchParams(window.location.search).get("next"));
  }, [next]);

  const [status, setStatus] = useState("正在完成登录确认...");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase && !authAdapter) {
      setError("缺少 PUBLIC_SUPABASE_URL 或 PUBLIC_SUPABASE_ANON_KEY。");
      return;
    }

    let mounted = true;
    let timeoutId: number | undefined;

    async function redirectIfReady() {
      const adapterSession = authAdapter ? await authAdapter.getSession() : null;
      const { data } = authAdapter ? { data: { session: adapterSession ? { access_token: adapterSession.accessToken } : null } } : await supabase!.auth.getSession();
      if (!mounted) return;

      if (data.session?.access_token) {
        try {
          const consent = consentAdapter ? await consentAdapter.getCurrentConsent(data.session.access_token) : await getLegalConsentStatus(data.session.access_token);
          navigation.replace(consent.current ? safeNext : `/legal-consent/?next=${encodeURIComponent(safeNext)}&reason=callback`);
        } catch {
          navigation.replace(`/legal-consent/?next=${encodeURIComponent(safeNext)}&reason=callback`);
        }
      }
    }

    async function boot() {
      try {
        const currentUrl = new URL(window.location.href);
        const code = currentUrl.searchParams.get("code");

        if (code && !authAdapter) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            throw exchangeError;
          }
        }

        await redirectIfReady();

        if (authAdapter) return;
        const { data: listener } = supabase!.auth.onAuthStateChange((event, session) => {
          if (!mounted) return;

          if (session?.access_token && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
            void redirectIfReady();
          }
        });

        timeoutId = window.setTimeout(() => {
          if (!mounted) return;
          setStatus("仍在等待会话建立。若你刚完成邮箱验证，请稍候或重新打开确认链接。");
        }, 2500);

        return () => {
          listener.subscription.unsubscribe();
        };
      } catch (callbackError) {
        if (!mounted) return;
        const rawMessage = callbackError instanceof Error ? callbackError.message : "登录确认失败。";
        setError(mapCallbackError(rawMessage));
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
  }, [safeNext, supabase, authAdapter, consentAdapter, navigation]);

  return (
    <section className="auth-card">
      <div className="auth-card__top">
        <h2 style={{ margin: 0 }}>确认登录</h2>
        <p style={{ margin: 0, color: "var(--text-muted)" }}>OpenGlass Hub 正在处理邮箱确认或登录回调。</p>
      </div>
      <div className="auth-alert">{status}</div>
      {error ? (
        <div className="auth-feedback">
          <div className="auth-alert auth-alert--error">{error}</div>
          <div className="community-cta-row">
            <a className="community-button--secondary" href={`/login/?next=${encodeURIComponent(safeNext)}`}>
              返回登录页
            </a>
          </div>
        </div>
      ) : null}
    </section>
  );
}
