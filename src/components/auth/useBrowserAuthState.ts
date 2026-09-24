import { useEffect, useState } from "react";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";

export type BrowserAuthStatus = "checking" | "pending_verification" | "signed_in" | "signed_out" | "error" | "timeout";

export interface BrowserAuthState {
  status: BrowserAuthStatus;
  user: User | null;
}

interface UseBrowserAuthStateOptions {
  timeoutMs?: number;
}

export function useBrowserAuthState(
  supabase: SupabaseClient | null,
  options?: UseBrowserAuthStateOptions,
): BrowserAuthState {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const [state, setState] = useState<BrowserAuthState>({
    status: "checking",
    user: null,
  });

  useEffect(() => {
    if (!supabase) {
      setState({ status: "error", user: null });
      return;
    }

    let mounted = true;
    let generation = 0;
    let timeoutId: number | undefined;

    const checkSession = async (session: Session | null) => {
      const current = ++generation;
      window.clearTimeout(timeoutId);
      if (!session?.access_token || !session.user) {
        setState({ status: "signed_out", user: null });
        return;
      }

      setState({ status: "checking", user: null });
      timeoutId = window.setTimeout(() => {
        if (mounted && current === generation) {
          ++generation;
          setState({ status: "timeout", user: null });
        }
      }, timeoutMs);
      try {
        const response = await fetch("/api/auth/session-state", {
          headers: { authorization: `Bearer ${session.access_token}` },
        });
        const payload = await response.json().catch(() => null) as { state?: string } | null;
        if (!mounted || current !== generation) return;
        window.clearTimeout(timeoutId);
        if (!response.ok) {
          setState({ status: "error", user: null });
        } else if (payload?.state === "VERIFIED_AUTHENTICATED") {
          setState({ status: "signed_in", user: session.user });
        } else if (payload?.state === "PENDING_VERIFICATION") {
          setState({ status: "pending_verification", user: null });
        } else if (payload?.state === "ANONYMOUS") {
          setState({ status: "signed_out", user: null });
        } else {
          setState({ status: "error", user: null });
        }
      } catch {
        if (mounted && current === generation) {
          window.clearTimeout(timeoutId);
          setState({ status: "error", user: null });
        }
      }
    };

    setState({ status: "checking", user: null });

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!mounted || generation > 0) return;
        if (error) {
          console.warn("[browser-auth] getSession failed", error.message);
          setState({ status: "error", user: null });
          return;
        }
        void checkSession(data.session);
      })
      .catch((error) => {
        if (!mounted || generation > 0) return;
        console.warn("[browser-auth] getSession crashed", error);
        setState({ status: "error", user: null });
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      void checkSession(session);
    });

    return () => {
      mounted = false;
      ++generation;
      window.clearTimeout(timeoutId);
      listener.subscription.unsubscribe();
    };
  }, [supabase, timeoutMs]);

  return state;
}
