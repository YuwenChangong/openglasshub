import { useCallback, useEffect, useRef, useState } from "react";

const TURNSTILE_SITE_KEY =
  import.meta.env.PUBLIC_TURNSTILE_SITE_KEY ||
  import.meta.env.ASTRO_PUBLIC_TURNSTILE_SITE_KEY ||
  "";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          size?: "normal" | "compact" | "invisible";
          callback?: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
        },
      ) => string | number;
      reset: (widgetId?: string | number) => void;
      execute?: (widgetId?: string | number) => void;
    };
  }
}

export function useInvisibleTurnstile(errorMessage = "安全验证失败，请刷新后重试。") {
  const [ready, setReady] = useState(!TURNSTILE_SITE_KEY);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetRef = useRef<string | number | null>(null);
  const tokenRef = useRef("");

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let cancelled = false;

    const renderWidget = () => {
      if (cancelled || !window.turnstile) return;
      if (containerRef.current && widgetRef.current == null) {
        widgetRef.current = window.turnstile.render(containerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          size: "invisible",
          callback: (nextToken) => {
            setError("");
            setToken(nextToken);
          },
          "error-callback": () => setError(errorMessage),
          "expired-callback": () => setToken(""),
        });
      }
      setReady(true);
    };

    if (window.turnstile) {
      renderWidget();
      return () => {
        cancelled = true;
      };
    }

    const scriptSelector =
      'script[src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"]';
    const existing = document.querySelector<HTMLScriptElement>(scriptSelector);
    const script = existing ?? document.createElement("script");
    if (!existing) {
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    const onLoad = () => renderWidget();
    script.addEventListener("load", onLoad);
    return () => {
      cancelled = true;
      script.removeEventListener("load", onLoad);
    };
  }, [errorMessage]);

  const resetToken = useCallback(() => {
    setToken("");
    if (widgetRef.current != null && window.turnstile) {
      window.turnstile.reset(widgetRef.current);
    }
  }, []);

  const ensureToken = useCallback(async (options?: { forceRefresh?: boolean }) => {
    const forceRefresh = options?.forceRefresh === true;
    if (!TURNSTILE_SITE_KEY) return "";
    if (!forceRefresh && tokenRef.current) return tokenRef.current;

    setToken("");
    if (widgetRef.current != null && window.turnstile) {
      window.turnstile.reset(widgetRef.current);
    }
    if (widgetRef.current != null && window.turnstile?.execute) {
      window.turnstile.execute(widgetRef.current);
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < 4000) {
      if (tokenRef.current) {
        return tokenRef.current;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    return "";
  }, []);

  return {
    siteKeyEnabled: Boolean(TURNSTILE_SITE_KEY),
    ready,
    token,
    error,
    containerRef,
    ensureToken,
    resetToken,
  };
}
