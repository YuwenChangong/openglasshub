import { useEffect, useMemo, useState } from "react";
import { getSafeConsentNext } from "../../lib/legal-consent-navigation";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { getAuthMessages, type AuthLocale, type AuthMessages } from "../../lib/auth-messages";
import { browserNavigationAdapter, type LegalConsentAdapter, type LegalConsentAuthAdapter, type LegalConsentNavigationAdapter } from "../../lib/legal-consent-adapters";
import { clearAuthCallbackUrl, hasAuthCallbackError } from "../../lib/auth-callback-url";

interface AuthCallbackProps {
  locale?: AuthLocale;
  next?: string;
  authAdapter?: LegalConsentAuthAdapter;
  /** @deprecated Retained for adapter compatibility; callback does not use consent. */
  consentAdapter?: LegalConsentAdapter;
  navigationAdapter?: LegalConsentNavigationAdapter;
  codeExchange?: (code: string, flowId?: string) => Promise<{ error: Error | null }>;
}

function mapCallbackError(errorMessage: string, messages: AuthMessages): string {
  if (/Auth session missing/i.test(errorMessage)) return messages.callbackMissing;
  return messages.callbackFailed;
}

export default function AuthCallback({ locale = "zh-CN", next, authAdapter, navigationAdapter, codeExchange }: AuthCallbackProps) {
  const messages = getAuthMessages(locale);
  const supabase = useMemo(() => authAdapter ? null : createBrowserSupabaseClient(), [authAdapter]);
  const navigation = useMemo(() => navigationAdapter ?? browserNavigationAdapter(), [navigationAdapter]);
  const safeNext = useMemo(() => {
    if (next) return getSafeConsentNext(next);
    if (typeof window === "undefined") return "/feed/";
    return getSafeConsentNext(new URLSearchParams(window.location.search).get("next"));
  }, [next]);

  const [status, setStatus] = useState(messages.callbackPending);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase && !authAdapter) {
      clearAuthCallbackUrl();
      setError(messages.configurationUnavailable);
      return;
    }

    let mounted = true;
    let redirected = false;
    let timeoutId: number | undefined;

    async function redirectIfReady() {
      const adapterSession = authAdapter ? await authAdapter.getSession() : null;
      const { data } = authAdapter ? { data: { session: adapterSession ? { access_token: adapterSession.accessToken } : null } } : await supabase!.auth.getSession();
      if (!mounted || redirected) return;

      if (data.session?.access_token) {
        redirected = true;
        if (timeoutId) window.clearTimeout(timeoutId);
        clearAuthCallbackUrl();
        try { navigation.replace(safeNext); }
        catch { setError(messages.callbackFailed); }
      }
    }

    async function boot() {
      try {
        const currentUrl = new URL(window.location.href);
        const providerError = hasAuthCallbackError(currentUrl);
        const code = currentUrl.searchParams.get("code");
        const flowId = currentUrl.searchParams.get("sb_flow_id") ?? undefined;
        if (providerError || currentUrl.searchParams.has("code")) {
          if (!clearAuthCallbackUrl()) { setError(messages.callbackFailed); return; }
        }
        if (providerError || (currentUrl.searchParams.has("code") && !code)) {
          setError(messages.callbackFailed);
          return;
        }

        if (code && (!authAdapter || codeExchange)) {
          const { error: exchangeError } = codeExchange ? await codeExchange(code, flowId) : await supabase!.auth.exchangeCodeForSession(code, flowId === undefined ? undefined : { flowId });
          if (exchangeError) {
            throw exchangeError;
          }
        }

        await redirectIfReady();

        if (authAdapter || !mounted || redirected) return;
        const { data: listener } = supabase!.auth.onAuthStateChange((event, session) => {
          if (!mounted) return;

          if (session?.access_token && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
            void redirectIfReady();
          }
        });

        timeoutId = window.setTimeout(() => {
          if (!mounted) return;
          clearAuthCallbackUrl();
          setStatus(messages.callbackWaiting);
        }, 2500);

        return () => {
          listener.subscription.unsubscribe();
        };
      } catch (callbackError) {
        if (!mounted) return;
        clearAuthCallbackUrl();
        const rawMessage = callbackError instanceof Error ? callbackError.message : "";
        setError(mapCallbackError(rawMessage, messages));
      }
    }

    let unsubscribe: (() => void) | undefined;
    void boot().then((cleanup) => {
      if (!mounted) cleanup?.();
      else unsubscribe = cleanup;
    });

    return () => {
      mounted = false;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      unsubscribe?.();
    };
  }, [safeNext, supabase, authAdapter, navigation, codeExchange]);

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
