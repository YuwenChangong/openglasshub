import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { TurnstileApi, TurnstileWidgetId } from "../../lib/turnstile-api";

export interface AuthCaptchaAdapter {
  acquireToken(): Promise<string | null>;
  reset(): void;
}

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptLoad: Promise<TurnstileApi | null> | null = null;

function loadTurnstile(): Promise<TurnstileApi | null> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptLoad) return scriptLoad;
  scriptLoad = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    const timeout = window.setTimeout(() => finish(null), 10_000);
    function finish(api: TurnstileApi | null) {
      window.clearTimeout(timeout);
      resolve(api);
    }
    script.onload = () => finish(window.turnstile ?? null);
    script.onerror = () => finish(null);
    document.head.appendChild(script);
  });
  return scriptLoad;
}

interface AuthTurnstileProps {
  siteKey: string;
  locale: "zh-CN" | "en";
}

const AuthTurnstile = forwardRef<AuthCaptchaAdapter, AuthTurnstileProps>(function AuthTurnstile({ siteKey, locale }, ref) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<TurnstileWidgetId | null>(null);
  const token = useRef<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useImperativeHandle(ref, () => ({
    async acquireToken() {
      const current = token.current;
      token.current = null;
      return current;
    },
    reset() {
      token.current = null;
      if (widgetId.current !== null && window.turnstile) {
        try { window.turnstile.reset(widgetId.current); } catch { setUnavailable(true); }
      }
    },
  }), []);

  useEffect(() => {
    let active = true;
    token.current = null;
    setUnavailable(false);
    void loadTurnstile().then((api) => {
      if (!active || !container.current) return;
      if (!api) { setUnavailable(true); return; }
      try {
        widgetId.current = api.render(container.current, {
          sitekey: siteKey,
          theme: "dark",
          appearance: "interaction-only",
          size: "flexible",
          "response-field": false,
          execution: "render",
          callback: (value: string) => { if (active) { token.current = value; setUnavailable(false); } },
          "expired-callback": () => { if (active) { token.current = null; setUnavailable(true); } },
          "error-callback": () => { if (active) { token.current = null; setUnavailable(true); } },
          "timeout-callback": () => { if (active) { token.current = null; setUnavailable(true); } },
          "unsupported-callback": () => { if (active) { token.current = null; setUnavailable(true); } },
        });
      } catch { setUnavailable(true); }
    });
    return () => {
      active = false;
      token.current = null;
      if (widgetId.current !== null && window.turnstile) {
        try { window.turnstile.remove(widgetId.current); } catch { /* detached widget */ }
      }
      widgetId.current = null;
    };
  }, [siteKey]);

  return <div className="auth-turnstile" style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}>
    <div ref={container} style={{ width: "100%", maxWidth: "100%", minWidth: 0 }} />
    {unavailable ? <div role="status" className="auth-alert auth-alert--error">{locale === "en" ? "Verification unavailable. Refresh and try again." : "验证暂不可用，请刷新后重试。"}</div> : null}
  </div>;
});

export default AuthTurnstile;
