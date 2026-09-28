import { useEffect, useMemo, useState } from "react";
import { getSafeNext } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { getLegalConsentStatus } from "../../lib/legal-consent-client";
import { getAuthMessages, type AuthLocale, type AuthMessages } from "../../lib/auth-messages";
import { browserNavigationAdapter, type LegalConsentAdapter, type LegalConsentAuthAdapter, type LegalConsentNavigationAdapter } from "../../lib/legal-consent-adapters";

interface AuthCallbackProps {
  locale?: AuthLocale;
  next?: string;
  authAdapter?: LegalConsentAuthAdapter;
  consentAdapter?: LegalConsentAdapter;
  navigationAdapter?: LegalConsentNavigationAdapter;
}

function mapCallbackError(errorMessage: string, messages: AuthMessages): string {
  if (/Auth session missing/i.test(errorMessage)) return messages.callbackMissing;
  return messages.callbackFailed;
}

export default function AuthCallback({ locale = "zh-CN", next, authAdapter, consentAdapter, navigationAdapter }: AuthCallbackProps) {
  const messages = getAuthMessages(locale);
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const navigation = useMemo(() => navigationAdapter ?? browserNavigationAdapter(), [navigationAdapter]);
  const safeNext = useMemo(() => {
    if (next) return getSafeNext(next);
    if (typeof window === "undefined") return "/";
    return getSafeNext(new URLSearchParams(window.location.search).get("next"));
  }, [next]);

  const [status, setStatus] = useState(messages.callbackPending);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase && !authAdapter) {
      setError(messages.configurationUnavailable);
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
          setStatus(messages.callbackWaiting);
        }, 2500);

        return () => {
          listener.subscription.unsubscribe();
        };
      } catch (callbackError) {
        if (!mounted) return;
        const rawMessage = callbackError instanceof Error ? callbackError.message : "";
        setError(mapCallbackError(rawMessage, messages));
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
        <h2 style={{ margin: 0 }}>{messages.callbackHeading}</h2>
      </div>
      <div className="auth-alert">{status}</div>
      {error ? (
        <div className="auth-feedback">
          <div className="auth-alert auth-alert--error">{error}</div>
          <div className="community-cta-row">
            <a className="community-button--secondary" href={`/login/?next=${encodeURIComponent(safeNext)}`}>
              {messages.backToLogin}
            </a>
          </div>
        </div>
      ) : null}
    </section>
  );
}
