import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { AdminApiError, adminFetch } from "../../lib/admin-api-client";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";

type AdminMePayload = {
  user_id: string;
  role: string;
  allowed: boolean;
  profile?: {
    username?: string | null;
    display_name?: string | null;
    avatar_url?: string | null;
  } | null;
};

export type AdminSessionState =
  | { status: "checking"; message: string }
  | { status: "signed_out"; message: string; details?: string }
  | { status: "forbidden"; message: string; details?: string }
  | { status: "ready"; message: string; session: Session; me: AdminMePayload }
  | { status: "error"; message: string; details?: string }
  | { status: "timeout"; message: string; details?: string };

const SESSION_TIMEOUT_MS = 8_000;

export function useAdminSession() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [state, setState] = useState<AdminSessionState>({
    status: "checking",
    message: "正在确认登录状态...",
  });
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!supabase) {
      if (mountedRef.current) {
        setState({
          status: "error",
          message: "Supabase 浏览器客户端不可用",
          details: "session check started -> client unavailable",
        });
      }
      return;
    }

    const debugEvents: string[] = ["session check started"];
    const timeoutId = window.setTimeout(() => {
      if (!mountedRef.current) return;
      setState({
        status: "timeout",
        message: "登录状态确认超时，请刷新页面或重新登录",
        details: debugEvents.join(" | "),
      });
    }, SESSION_TIMEOUT_MS);

    if (mountedRef.current) {
      setState({
        status: "checking",
        message: "正在确认登录状态...",
      });
    }

    try {
      const { data, error } = await supabase.auth.getSession();
      if (!mountedRef.current) return;

      if (error) {
        debugEvents.push(`session error: ${error.message}`);
        setState({
          status: "error",
          message: "登录状态读取失败",
          details: debugEvents.join(" | "),
        });
        return;
      }

      const session = data.session ?? null;
      if (!session?.access_token) {
        debugEvents.push("session not found");
        setState({
          status: "signed_out",
          message: "请先登录",
          details: debugEvents.join(" | "),
        });
        return;
      }

      debugEvents.push("session found");

      try {
        const me = await adminFetch<AdminMePayload>("/api/admin/forum/me", {
          method: "GET",
          session,
        });
        if (!mountedRef.current) return;
        debugEvents.push("api status code: 200");
        setState({
          status: "ready",
          message: "管理员权限已确认",
          session,
          me,
        });
      } catch (meError) {
        if (!mountedRef.current) return;
        if (meError instanceof AdminApiError) {
          debugEvents.push(`api status code: ${meError.status}`);
          debugEvents.push(`error message: ${meError.message}`);
          if (meError.status === 401) {
            setState({
              status: "signed_out",
              message: "登录状态已失效，请重新登录",
              details: debugEvents.join(" | "),
            });
            return;
          }
          if (meError.status === 403) {
            setState({
              status: "forbidden",
              message: "当前账号没有管理员权限",
              details:
                typeof meError.details === "string" ? meError.details : debugEvents.join(" | "),
            });
            return;
          }
        }

        setState({
          status: "error",
          message: meError instanceof Error ? meError.message : "管理员权限确认失败",
          details: debugEvents.join(" | "),
        });
      }
    } catch (unknownError) {
      if (!mountedRef.current) return;
      debugEvents.push(
        `error message: ${unknownError instanceof Error ? unknownError.message : "unknown error"}`,
      );
      setState({
        status: "error",
        message: unknownError instanceof Error ? unknownError.message : "登录状态确认失败",
        details: debugEvents.join(" | "),
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
  }, [supabase]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();

    if (!supabase) {
      return () => {
        mountedRef.current = false;
      };
    }

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      void refresh();
    });

    return () => {
      mountedRef.current = false;
      listener.subscription.unsubscribe();
    };
  }, [refresh, supabase]);

  return {
    supabase: supabase as SupabaseClient | null,
    state,
    setState,
    session: state.status === "ready" ? state.session : null,
    accessToken: state.status === "ready" ? state.session.access_token : null,
    me: state.status === "ready" ? state.me : null,
    refresh,
  };
}
