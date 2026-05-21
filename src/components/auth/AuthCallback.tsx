import { useEffect, useMemo, useState } from "react";
import { getSafeNext } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";

interface AuthCallbackProps {
  next?: string;
}

const wrapperStyle: React.CSSProperties = {
  maxWidth: "720px",
  margin: "3rem auto",
  padding: "1.5rem",
  border: "1px solid var(--sl-color-gray-5)",
  borderRadius: "0.75rem",
  background: "var(--sl-color-bg-nav)",
};

const messageStyle: React.CSSProperties = {
  border: "1px solid var(--sl-color-gray-5)",
  borderRadius: "0.5rem",
  padding: "0.75rem",
  fontSize: "0.95rem",
};

export default function AuthCallback({ next }: AuthCallbackProps) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const safeNext = useMemo(() => {
    if (next) return getSafeNext(next);
    if (typeof window === "undefined") return "/";
    return getSafeNext(new URLSearchParams(window.location.search).get("next"));
  }, [next]);

  const [status, setStatus] = useState("正在完成登录确认...");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase) {
      setError("缺少 PUBLIC_SUPABASE_URL 或 PUBLIC_SUPABASE_ANON_KEY。");
      return;
    }

    let mounted = true;
    let timeoutId: number | undefined;

    async function redirectIfReady() {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!mounted) return;

      if (sessionError) {
        setError(sessionError.message);
        return;
      }

      if (data.session) {
        window.location.replace(safeNext);
      }
    }

    async function boot() {
      try {
        const currentUrl = new URL(window.location.href);
        const code = currentUrl.searchParams.get("code");

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            throw exchangeError;
          }
        }

        await redirectIfReady();

        const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
          if (!mounted) return;

          if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
            window.location.replace(safeNext);
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
        setError(callbackError instanceof Error ? callbackError.message : "登录确认失败。");
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
  }, [safeNext, supabase]);

  return (
    <section style={wrapperStyle}>
      <h2>确认登录</h2>
      <p>OpenGlass Hub 正在处理邮箱确认或登录回调。</p>
      <div style={messageStyle}>{status}</div>
      {error ? (
        <div style={{ ...messageStyle, marginTop: "1rem" }}>
          错误：{error}
          <div style={{ marginTop: "0.75rem" }}>
            <a href={`/login/?next=${encodeURIComponent(safeNext)}`}>返回登录页</a>
          </div>
        </div>
      ) : null}
    </section>
  );
}
